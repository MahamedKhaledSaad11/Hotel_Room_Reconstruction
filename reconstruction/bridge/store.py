"""Readable, atomic, restart-safe local run storage. No database required."""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import secrets
import struct
import threading
import time
import uuid


TERMINAL = {"completed", "failed", "timed_out"}


def atomic_json(path: Path, value: dict) -> None:
    temp = path.with_name(path.name + ".tmp")
    with temp.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False, allow_nan=False)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


class Store:
    def __init__(self, root: Path, timeout: int = 1800, max_runtime: int = 21600):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.timeout = timeout
        self.max_runtime = max_runtime
        self.lock = threading.RLock()
        secret_path = self.root / "operator-secret.txt"
        if not secret_path.exists():
            temp = secret_path.with_suffix(".tmp")
            with temp.open("w", encoding="ascii") as stream:
                stream.write(secrets.token_urlsafe(32))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp, secret_path)
        self.operator_secret = secret_path.read_text(encoding="ascii").strip()
        if len(self.operator_secret) < 32:
            raise ValueError("operator-secret.txt is damaged. Remove that file locally to create a new operator key.")

    def directory(self, run_id: str) -> Path:
        if len(run_id) != 32 or any(c not in "0123456789abcdef" for c in run_id):
            raise KeyError(run_id)
        return self.root / run_id

    def get(self, run_id: str) -> dict:
        try:
            with self.lock:
                return json.loads((self.directory(run_id) / "run.json").read_text(encoding="utf-8"))
        except FileNotFoundError as exc:
            raise KeyError(run_id) from exc

    def save(self, run: dict) -> None:
        atomic_json(self.directory(run["id"]) / "run.json", run)

    def create(self, filename: str) -> dict:
        with self.lock:
            now = time.time()
            run = {"id": uuid.uuid4().hex, "filename": Path(filename.replace("\\", "/")).name[:200],
                   "status": "uploading", "stage": "upload", "progress": 0,
                   "attempt": 1, "worker_token": secrets.token_urlsafe(32),
                   "created_at": now, "updated_at": now, "heartbeat_at": now,
                   "attempt_started_at": now, "error": None, "dispatch": None}
            self.directory(run["id"]).mkdir()
            self.save(run)
            return run

    def update(self, run_id: str, **changes) -> dict:
        with self.lock:
            run = self.get(run_id)
            run.update(changes, updated_at=time.time())
            self.save(run)
            return run

    def list(self) -> list[dict]:
        with self.lock:
            runs = []
            for path in self.root.glob("*/run.json"):
                try:
                    runs.append(self.get(path.parent.name))
                except (KeyError, json.JSONDecodeError):
                    continue
            return sorted(runs, key=lambda item: item["created_at"], reverse=True)

    def expire(self) -> None:
        with self.lock:
            now = time.time()
            for run in self.list():
                if run["status"] in TERMINAL:
                    continue
                idle = now - run["heartbeat_at"] > self.timeout
                over = now - run.get("attempt_started_at", run["created_at"]) > self.max_runtime
                if idle or over:
                    self.update(run["id"], status="timed_out", error=(
                        "Worker exceeded maximum run duration. Retry the run." if over else
                        "Upload or worker heartbeat expired. Check network/Kaggle status, then retry."))

    def retry(self, run_id: str) -> dict:
        with self.lock:
            run = self.get(run_id)
            if run["status"] not in {"failed", "timed_out"}:
                raise ValueError("Only failed or timed out runs may be retried.")
            if not (self.directory(run_id) / "video").is_file():
                raise ValueError("The upload did not finish. Choose and upload the video again.")
            # Retain prior output as evidence while ensuring it cannot complete a new attempt.
            for name in ("scene.splat", "run_manifest.json"):
                path = self.directory(run_id) / name
                if path.exists():
                    path.replace(path.with_name(f"attempt-{run['attempt']}-{name}"))
            now = time.time()
            return self.update(run_id, status="queued", stage="queued", progress=0,
                               attempt=run["attempt"] + 1, worker_token=secrets.token_urlsafe(32),
                               heartbeat_at=now, attempt_started_at=now, error=None, dispatch=None,
                               artifact=None, retrieval_attempts=0, remote_status=None, message="")


def validate_splat(path: Path) -> dict:
    size = path.stat().st_size
    if size == 0 or size % 32:
        raise ValueError("Splat must contain complete nonempty 32-byte Gaussian records.")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(32 * 8192):
            digest.update(chunk)
            for record in struct.iter_unpack("<6f8B", chunk):
                if not all(math.isfinite(x) for x in record[:6]) or any(x <= 0 for x in record[3:6]):
                    raise ValueError("Splat contains nonfinite positions or invalid scales.")
    return {"bytes": size, "sha256": digest.hexdigest(), "gaussian_count": size // 32}


def verify_manifest(manifest: dict, artifact: dict) -> None:
    if (type(manifest.get("bytes")) is not int or manifest["bytes"] <= 0 or
            type(manifest.get("gaussian_count")) is not int or manifest["gaussian_count"] <= 0 or
            not isinstance(manifest.get("sha256"), str) or len(manifest["sha256"]) != 64 or
            any(c not in "0123456789abcdef" for c in manifest["sha256"])):
        raise ValueError("Manifest requires positive bytes/count and a lowercase SHA-256 digest.")
    if manifest.get("schema_version") != 1 or manifest.get("format") != "splat" or manifest.get("artifact") != "scene.splat":
        raise ValueError("Manifest requires schema_version=1, format=splat, artifact=scene.splat.")
    for field in ("bytes", "sha256", "gaussian_count"):
        if manifest.get(field) != artifact[field]:
            raise ValueError(f"Manifest {field} does not match the verified artifact.")
