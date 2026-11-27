"""Supported Kaggle CLI dispatch with a private immutable kernel per attempt."""
from __future__ import annotations

import argparse
import base64
import gzip
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import uuid

from .worker import validate_payload


class DispatchError(RuntimeError):
    pass


def source_archive(project_root=None):
    root = Path(project_root or Path(__file__).resolve().parents[2])
    package = root / "reconstruction"
    pipeline = package / "pipeline"
    if package.is_symlink() or pipeline.is_symlink():
        raise DispatchError("Source package directories must not be symlinks")
    if not (pipeline / "__main__.py").is_file():
        raise DispatchError("reconstruction/pipeline/__main__.py must exist before building the notebook")
    # Explicit source-only allowlist: never traverse runtime directories, upload storage,
    # environment packages, credentials, or symlinks below reconstruction/.
    paths = [package / "__init__.py", *sorted(pipeline.glob("*.py")),
             *(package / "kaggle" / name for name in ("__init__.py", "worker.py", "setup_environment.py"))]
    result = io.BytesIO()
    with gzip.GzipFile(fileobj=result, mode="wb", mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
            for path in paths:
                if not path.is_file() or path.is_symlink() or path.parent.is_symlink():
                    raise DispatchError("Required source file is missing or is a symlink: " + str(path))
                data = path.read_bytes()
                info = tarfile.TarInfo(path.relative_to(root).as_posix())
                info.size = len(data)
                info.mode = 0o644
                info.mtime = 0
                archive.addfile(info, io.BytesIO(data))
    return base64.b64encode(result.getvalue()).decode()


def build_notebook(*, payload=None, pose_estimator="colmap", pipeline_args=None,
                   project_root=None, embed_source=True, bridge_smoke=False):
    if payload is not None:
        validate_payload(payload)
    archive = source_archive(project_root) if embed_source else None
    config = {"payload": payload, "video": "Video_0.mp4",
              "output": "/kaggle/working/run", "pose_estimator": pose_estimator,
              "pipeline_args": pipeline_args or [], "bridge_smoke": bridge_smoke}
    config_code = "# Edit VIDEO_PATH for a standalone uploaded Kaggle dataset.\n"
    config_code += "import json\nCONFIG = json.loads(" + repr(json.dumps(config)) + ")\n"
    config_code += "VIDEO_PATH = CONFIG['video']\n"
    bootstrap = """from pathlib import Path
import base64, io, os, sys, tarfile
"""
    if archive:
        bootstrap += "_archive = " + repr(archive) + "\n"
        bootstrap += """SOURCE_ROOT = Path('/kaggle/working/reconstruction-source')
SOURCE_ROOT.mkdir(parents=True, exist_ok=True)
with tarfile.open(fileobj=io.BytesIO(base64.b64decode(_archive)), mode='r:gz') as bundle:
    for member in bundle.getmembers():
        target = (SOURCE_ROOT / member.name).resolve()
        if not target.is_relative_to(SOURCE_ROOT.resolve()) or not member.isfile():
            raise RuntimeError('Invalid packaged source path')
    bundle.extractall(SOURCE_ROOT, filter='data')
del _archive
"""
    else:
        bootstrap += """# Attach the reconstruction source as a Kaggle dataset, or upload the built self-contained notebook.
SOURCE_ROOT = Path('/kaggle/input/reconstruction-source')
if not (SOURCE_ROOT / 'reconstruction/pipeline/__main__.py').is_file():
    raise RuntimeError('Attach reconstruction-source dataset or build a self-contained notebook with launcher --build-only')
"""
    bootstrap += """os.chdir(SOURCE_ROOT)
sys.path.insert(0, str(SOURCE_ROOT))
from reconstruction.kaggle.worker import BridgeClient, ProgressPump, run
from reconstruction.kaggle.setup_environment import prepare, VGGT_REVISION
from contextlib import nullcontext
client = BridgeClient(CONFIG['payload']) if CONFIG['payload'] else None
try:
    if CONFIG.get('bridge_smoke'):
        if client is None: raise RuntimeError('Bridge smoke needs a scoped payload')
        smoke_dir = Path(CONFIG['output'])
        smoke_dir.mkdir(parents=True, exist_ok=True)
        client.progress({'stage':'testing_bridge','progress':None,'message':'Kaggle HTTPS callback reached bridge'})
        downloaded = client.download(smoke_dir / 'input.mp4')
        client.progress({'stage':'bridge_smoke_complete','progress':None,'message':f'Input downloaded: {downloaded.stat().st_size} bytes; no GPU reconstruction requested'})
    else:
        if client is None and not Path(VIDEO_PATH).is_file():
            matches = list(Path('/kaggle/input').rglob(VIDEO_PATH)) if Path(VIDEO_PATH).name == VIDEO_PATH else []
            if len(matches) != 1:
                raise ValueError('Set VIDEO_PATH to the exact path of one attached video in the configuration cell')
            VIDEO_PATH = str(matches[0])
        with (ProgressPump(client) if client else nullcontext()) as pump:
            preparation = {'event':'progress','stage':'preparing_environment','progress':None,
                           'message':'Preparing the pinned CUDA and reconstruction environment'}
            print(json.dumps(preparation), flush=True)
            if pump: pump.emit(preparation)
            runtime = prepare(with_vggt=CONFIG['pose_estimator']=='vggt' or '--compare-poses' in CONFIG['pipeline_args'], output='/kaggle/working/environment-report')
        pipeline_args = list(CONFIG['pipeline_args'])
        if (CONFIG['pose_estimator']=='vggt' or '--compare-poses' in pipeline_args) and '--vggt-code-revision' not in pipeline_args:
            pipeline_args += ['--vggt-code-revision', VGGT_REVISION]
        run(payload=CONFIG['payload'], video=VIDEO_PATH, output=CONFIG['output'],
            pose_estimator=CONFIG['pose_estimator'], pipeline_args=pipeline_args, **runtime)
except Exception as error:
    if client:
        safe = str(error).replace(CONFIG['payload']['token'], '[REDACTED]')
        try: client.progress({'event':'failed','stage':'failed','message':safe,'error':safe})
        except Exception: print('Could not deliver failure callback; inspect private kernel status')
    raise
"""
    def cell(kind, source):
        value = {"cell_type": kind, "metadata": {}, "source": source.splitlines(keepends=True)}
        if kind == "code":
            value.update(execution_count=None, outputs=[])
        return value
    return {"nbformat": 4, "nbformat_minor": 5,
            "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
                         "language_info": {"name": "python"}},
            "cells": [cell("markdown", "# Video to Gaussian scene\nPrivate T4 notebook. Enable Internet and GPU T4. Choose VIDEO_PATH below for standalone use.\nThe worker uses one T4; the second T4 is unused. Results remain under /kaggle/working/run and bridge jobs upload validated artifacts.\n"),
                      cell("code", config_code), cell("code", bootstrap)]}


class KaggleDispatcher:
    def __init__(self, *, username=None, dispatch_root=None, cli="kaggle", timeout_seconds=21600,
                 pose_estimator="colmap", pipeline_args=None, project_root=None, bridge_smoke=False):
        self.username = username or os.environ.get("KAGGLE_USERNAME")
        if not self.username:
            credential = Path(os.environ.get("KAGGLE_CONFIG_DIR", str(Path.home() / ".kaggle"))) / "kaggle.json"
            if credential.is_file():
                self.username = json.loads(credential.read_text()).get("username")
        if not self.username or not re.fullmatch(r"[A-Za-z0-9_-]+", self.username):
            raise DispatchError("Set KAGGLE_USERNAME or pass the authenticated Kaggle username explicitly")
        if pose_estimator not in ("colmap", "glomap", "vggt"):
            raise ValueError("Unknown pose estimator")
        self.dispatch_root = Path(dispatch_root or Path(tempfile.gettempdir()) / "reconstruction-dispatch")
        self.cli = cli
        self.timeout_seconds = timeout_seconds
        self.pose_estimator = pose_estimator
        self.pipeline_args = pipeline_args or []
        self.project_root = project_root
        self.bridge_smoke = bridge_smoke

    def prepare(self, payload, dataset_ref=None):
        if dataset_ref is None:
            validate_payload(payload)
        elif payload is not None:
            raise ValueError("Choose one input transport per notebook")
        dispatch_id = uuid.uuid4().hex
        slug = "reconstruction-" + dispatch_id
        kernel_ref = self.username + "/" + slug
        directory = self.dispatch_root / dispatch_id
        directory.mkdir(parents=True, exist_ok=False)
        try:
            directory.chmod(0o700)
        except OSError:
            pass
        notebook = build_notebook(payload=payload, pose_estimator=self.pose_estimator,
                                  pipeline_args=self.pipeline_args, project_root=self.project_root,
                                  bridge_smoke=self.bridge_smoke)
        source = directory / "reconstruction.ipynb"
        source.write_text(json.dumps(notebook), encoding="utf-8")
        try:
            source.chmod(0o600)
        except OSError:
            pass
        metadata = {"id": kernel_ref, "title": slug, "code_file": source.name, "language": "python",
                    "kernel_type": "notebook", "is_private": True, "enable_gpu": True,
                    "enable_internet": True, "machine_shape": "NvidiaTeslaT4", "dataset_sources": [dataset_ref] if dataset_ref else [],
                    "competition_sources": [], "kernel_sources": [], "model_sources": []}
        (directory / "kernel-metadata.json").write_text(json.dumps(metadata, indent=2))
        return directory, {"kernel_ref": kernel_ref, "kernel_url": "https://www.kaggle.com/code/" + kernel_ref,
                           "dispatch_id": dispatch_id, "status": "queued"}

    def submit(self, payload, dataset_ref=None):
        directory, result = self.prepare(payload, dataset_ref) if dataset_ref else self.prepare(payload)
        try:
            # Never blindly retry push: a timed-out request may have already started GPU execution.
            command = [self.cli, "kernels", "push", "-p", str(directory), "--accelerator", "NvidiaTeslaT4",
                       "--timeout", str(self.timeout_seconds)]
            completed = subprocess.run(command, capture_output=True, text=True, timeout=180)
            if completed.returncode:
                detail = (completed.stderr or completed.stdout)[-1500:]
                if payload is not None:
                    detail = detail.replace(payload["token"], "[REDACTED]")
                raise DispatchError(f"Kaggle push failed for {result['kernel_ref']}: {detail}")
            text = (completed.stdout + completed.stderr).lower()
            if "error" in text and "successfully" not in text:
                raise DispatchError(f"Kaggle push returned an error for {result['kernel_ref']}; inspect CLI authentication and quota")
            return result
        except (subprocess.TimeoutExpired, OSError) as error:
            raise DispatchError(f"Kaggle dispatch uncertain for {result['kernel_ref']}: {type(error).__name__}; check status before retrying") from None
        finally:
            # Source contains only a short-lived run token, but remove the local copy after upload.
            (directory / "reconstruction.ipynb").unlink(missing_ok=True)

    def status(self, kernel_ref):
        if not re.fullmatch(r"[A-Za-z0-9_-]+/[A-Za-z0-9_-]+", kernel_ref):
            raise ValueError("Invalid kernel reference")
        try:
            result = subprocess.run([self.cli, "kernels", "status", kernel_ref], capture_output=True,
                                    text=True, timeout=60)
        except (subprocess.TimeoutExpired, OSError) as error:
            raise DispatchError(f"Kaggle status unavailable: {type(error).__name__}") from None
        if result.returncode:
            raise DispatchError("Kaggle status failed; check credentials and kernel reference")
        raw = result.stdout.strip()
        match = re.search(r"(?:status[\s:\"']+)(?:[a-z_]+\.)?([a-z_]+)", raw.lower())
        label = match.group(1) if match else "unknown"
        status = {"queued": "queued", "pending": "queued", "running": "running", "complete": "complete",
                  "completed": "complete", "error": "failed", "failed": "failed", "cancelled": "failed"}.get(label, "unknown")
        return {"status": status, "raw_status": raw[-2000:]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload", type=Path, help="Local JSON with scoped worker URLs and token")
    parser.add_argument("--username")
    parser.add_argument("--build-only", type=Path, help="Write standalone self-contained notebook; do not push")
    parser.add_argument("--status", help="owner/kernel-slug")
    parser.add_argument("--pose-estimator", choices=["colmap", "glomap", "vggt"], default="colmap")
    parser.add_argument("--bridge-smoke", action="store_true", help="Download/callback connectivity only; no GPU setup or fabricated artifacts")
    args, pipeline_args = parser.parse_known_args()
    if args.build_only:
        args.build_only.parent.mkdir(parents=True, exist_ok=True)
        notebook = build_notebook(pose_estimator=args.pose_estimator, pipeline_args=pipeline_args)
        args.build_only.write_text(json.dumps(notebook, indent=1), encoding="utf-8")
        print(json.dumps({"notebook": str(args.build_only)}))
        return
    dispatcher = KaggleDispatcher(username=args.username, pose_estimator=args.pose_estimator,
                                  pipeline_args=pipeline_args, bridge_smoke=args.bridge_smoke)
    if args.status:
        print(json.dumps(dispatcher.status(args.status)))
    elif args.payload:
        print(json.dumps(dispatcher.submit(json.loads(args.payload.read_text()))))
    else:
        parser.error("Use --payload, --status, or --build-only")


if __name__ == "__main__":
    main()
