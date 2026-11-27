"""Run the public pipeline in a notebook; only stdlib is needed for the bridge."""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request


class WorkerError(RuntimeError):
    pass


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise WorkerError("Bridge redirects are forbidden; use the final HTTPS URL")


def validate_payload(payload: dict) -> dict:
    required = ("run_id", "attempt", "input_url", "progress_url", "artifact_url", "manifest_url", "token")
    if any(not payload.get(key) for key in required):
        raise ValueError("Worker payload is missing required run identifiers, URLs or scoped token")
    origins = set()
    for key in ("input_url", "progress_url", "artifact_url", "manifest_url"):
        parsed = urllib.parse.urlsplit(payload[key])
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
            raise ValueError("Worker URLs must use HTTPS without userinfo or fragments")
        origins.add((parsed.hostname, parsed.port or 443))
    if len(origins) != 1:
        raise ValueError("All scoped worker URLs must share one HTTPS origin")
    return payload


class BridgeClient:
    def __init__(self, payload: dict, *, attempts: int = 4):
        self.payload = validate_payload(payload)
        self.attempts = attempts
        self.opener = urllib.request.build_opener(_NoRedirect())

    def _request(self, key, *, data=None, file=None, method="GET", content_type=None, destination=None):
        for attempt in range(self.attempts):
            try:
                headers = {"Authorization": "Bearer " + self.payload["token"]}
                if content_type:
                    headers["Content-Type"] = content_type
                if file is not None:
                    headers["Content-Length"] = str(Path(file).stat().st_size)
                    body = open(file, "rb")
                else:
                    body = data
                try:
                    request = urllib.request.Request(self.payload[key], data=body, headers=headers, method=method)
                    with self.opener.open(request, timeout=120) as response:
                        if destination is None:
                            return response.read(1024 * 1024)
                        target = Path(destination)
                        part = target.with_suffix(target.suffix + ".part")
                        with part.open("wb") as stream:
                            while chunk := response.read(1024 * 1024):
                                stream.write(chunk)
                        part.replace(target)
                        return target
                finally:
                    if file is not None:
                        body.close()
            except urllib.error.HTTPError as error:
                if error.code not in (408, 429) and error.code < 500:
                    raise WorkerError(f"Bridge rejected {key}: HTTP {error.code}") from None
                if attempt + 1 == self.attempts:
                    raise WorkerError(f"Bridge {key} failed after retries: HTTP {error.code}") from None
            except (urllib.error.URLError, OSError, TimeoutError):
                if attempt + 1 == self.attempts:
                    raise WorkerError(f"Bridge {key} failed after network retries") from None
            time.sleep(min(2 ** attempt, 8))

    def progress(self, event: dict):
        progress = event.get("progress")
        if progress is not None and (not isinstance(progress, (int, float)) or not math.isfinite(progress)):
            progress = None
        body = {"stage": str(event.get("stage", "running")), "progress": progress,
                "message": str(event.get("message", ""))[:2000], "status": "running"}
        if event.get("event") == "failed" or event.get("status") == "failed":
            body.update(status="failed", error=str(event.get("error", body["message"]))[:2000])
        if progress is not None:
            body["progress"] = max(0, min(100, progress))
        return self._request("progress_url", method="POST", data=json.dumps(body).encode(), content_type="application/json")

    def download(self, destination):
        return self._request("input_url", destination=destination)

    def upload(self, output: Path):
        scene = output / "scene.splat"
        manifest_file = output / "run_manifest.json"
        if not scene.is_file() or not manifest_file.is_file():
            raise WorkerError("Pipeline did not produce scene.splat and run_manifest.json")
        size = scene.stat().st_size
        if size == 0 or size % 32:
            raise WorkerError("scene.splat has an invalid 32-byte record count")
        digest = hashlib.sha256()
        with scene.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
        manifest = json.loads(manifest_file.read_text())
        # Preserve pipeline geometry/camera metadata; bridge verification fields are additive.
        manifest.update(schema_version=1, format="splat", artifact="scene.splat",
                        sha256=digest.hexdigest(), bytes=size, gaussian_count=size // 32)
        for name in ("training_metrics.json", "pose_comparison.json", "environment.json"):
            path = output / name
            if path.is_file():
                manifest.setdefault("metrics", {})[path.stem] = json.loads(path.read_text())
        manifest_file.write_text(json.dumps(manifest, indent=2))
        self._request("artifact_url", file=scene, method="PUT", content_type="application/octet-stream")
        self._request("manifest_url", file=manifest_file, method="PUT", content_type="application/json")
        return manifest


class ProgressPump:
    """Callbacks run off the stdout reader; send real last-stage heartbeats while CLI is quiet."""
    def __init__(self, client, heartbeat_seconds=30):
        self.client = client
        self.heartbeat_seconds = heartbeat_seconds
        self.queue = queue.Queue(maxsize=1)
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._loop, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def emit(self, event):
        try:
            self.queue.get_nowait()
        except queue.Empty:
            pass
        self.queue.put_nowait(event)

    def _loop(self):
        latest = {"stage": "preparing_environment", "progress": None}
        while not self.stop.is_set():
            try:
                latest = self.queue.get(timeout=self.heartbeat_seconds)
            except queue.Empty:
                pass
            if self.stop.is_set():
                break
            try:
                self.client.progress(latest)
            except WorkerError:
                print("Bridge progress temporarily unavailable; retrying on next heartbeat", flush=True)

    def __exit__(self, *args):
        self.stop.set()
        self.emit({"stage": "stopping_progress", "progress": None})
        self.thread.join(timeout=2)


def run(*, payload=None, video=None, output="/kaggle/working/run", python=None,
        pose_estimator="colmap", pipeline_args=None, environment=None):
    """Standalone with a local uploaded video, or a single scoped bridge job."""
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    client = BridgeClient(payload) if payload is not None else None
    env = dict(os.environ, PYTHONUNBUFFERED="1", CUDA_VISIBLE_DEVICES="0", TORCH_CUDA_ARCH_LIST="7.5")
    if environment:
        env.update(environment)
    try:
        if client:
            client.progress({"stage": "downloading_video", "progress": None})
            # The pipeline claims an empty output directory. Keep input outside it.
            video = client.download(output.parent / (output.name + "-input.mp4"))
        if not video or not Path(video).is_file():
            raise WorkerError("Select an existing uploaded VIDEO_PATH or supply a bridge payload")
        command = [str(python or sys.executable), "-u", "-m", "reconstruction.pipeline", "--video", str(video),
                   "--output", str(output), "--pose-estimator", pose_estimator, *(pipeline_args or [])]
        from contextlib import nullcontext
        with (ProgressPump(client) if client else nullcontext()) as pump:
            with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                  bufsize=1, env=env) as process:
                for line in process.stdout:
                    # Never print a scoped credential even if a downstream exception echoes configuration.
                    clean = line.replace(payload["token"], "[REDACTED]") if payload else line
                    print(clean, end="", flush=True)
                    try:
                        event = json.loads(clean)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(event, dict) and event.get("event") in ("progress", "failed") and pump:
                        pump.emit(event)
                code = process.wait()
                if code:
                    raise WorkerError(f"Reconstruction pipeline exited with code {code}; see notebook logs")
        if client:
            client.progress({"stage": "uploading_artifacts", "progress": None})
            return client.upload(output)
        return {"output": str(output)}
    except Exception as error:
        if client:
            safe = str(error).replace(payload["token"], "[REDACTED]")
            try:
                client.progress({"event": "failed", "stage": "failed", "message": safe, "error": safe})
            except Exception:
                print("Failure callback unavailable; bridge must reconcile Kaggle status", flush=True)
        raise
