"""Exchange a single video and its scene with the operator's private Kaggle account."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import uuid

from .launcher import DispatchError, KaggleDispatcher


class PrivateDispatcher(KaggleDispatcher):
    def submit_video(self, video):
        slug = "room-input-" + uuid.uuid4().hex
        ref = self.username + "/" + slug
        with tempfile.TemporaryDirectory(prefix="room-upload-") as temporary:
            folder = Path(temporary)
            shutil.copyfile(video, folder / "Video_0.mp4")
            metadata = {"id": ref, "title": slug, "licenses": [{"name": "other"}]}
            (folder / "dataset-metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
            # Use a relative path: the Kaggle CLI encodes it in its Windows upload journal.
            subprocess.run([self.cli, "datasets", "create", "-p", ".", "--quiet"],
                           cwd=folder, check=True, timeout=1800, capture_output=True)
        deadline = time.monotonic() + 300
        while time.monotonic() < deadline:
            check = subprocess.run([self.cli, "datasets", "status", ref], capture_output=True,
                                   text=True, timeout=60)
            if check.returncode == 0 and "ready" in check.stdout.lower():
                result = self.submit(None, dataset_ref=ref)
                return dict(result, dataset_ref=ref)
            time.sleep(5)
        raise DispatchError("The private dataset is still processing: " + ref)

    def last_progress(self, ref):
        # The non-streaming CLI only guarantees a log after the kernel stops.
        # Read a bounded snapshot of the live stream, including its replayed history.
        try:
            result = subprocess.run([self.cli, "kernels", "logs", ref, "--follow"],
                                    capture_output=True, text=True, encoding="utf-8", errors="replace",
                                    env=dict(os.environ, PYTHONIOENCODING="utf-8"), timeout=8)
            text = result.stdout
        except subprocess.TimeoutExpired as exc:
            text = exc.stdout or ""
            if isinstance(text, bytes):
                text = text.decode("utf-8", errors="replace")
        for line in reversed(text.splitlines()):
            start = line.find('{"event":')
            if start < 0:
                continue
            try:
                event, _ = json.JSONDecoder().raw_decode(line[start:])
            except ValueError:
                continue
            if event.get("event") == "progress":
                return {k: event.get(k) for k in ("stage", "progress", "message")}
        return {}

    def collect(self, ref, destination):
        folder = Path(destination)
        folder.mkdir(parents=True, exist_ok=True)
        pattern = r"(?:^|/)run/(?:scene\.splat|run_manifest\.json)$"
        subprocess.run([self.cli, "kernels", "output", ref, "-p", str(folder),
                        "--file-pattern", pattern, "--quiet"], check=True, timeout=900, capture_output=True)
        files = list(folder.rglob("run_manifest.json"))
        if len(files) != 1 or not (files[0].parent / "scene.splat").is_file():
            raise DispatchError("Kaggle completed without a downloadable scene and manifest")
        return files[0].parent
