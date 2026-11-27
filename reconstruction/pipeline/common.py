import json
import os
from pathlib import Path
import shutil
import subprocess
import time
from datetime import datetime, timezone


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, indent=2, allow_nan=False), encoding="utf-8")
    os.replace(temporary, path)


def executable(name):
    found = shutil.which(str(name))
    if found is None:
        raise RuntimeError(f"Required executable not found: {name}. Install it or set its CLI path.")
    return found


def command(args, log_path):
    args = [str(a) for a in args]
    args[0] = executable(args[0])
    log_path = Path(log_path)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    with log_path.open("a", encoding="utf-8") as log:
        log.write("\nCOMMAND " + json.dumps(args) + "\n")
        log.flush()
        process = subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT)
        try:
            code = process.wait()
        except BaseException:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            raise
    if code:
        tail = log_path.read_text(encoding="utf-8", errors="replace")[-6000:]
        raise RuntimeError(f"{Path(args[0]).name} failed with exit {code}; log: {log_path}\n{tail}")
    return time.monotonic() - started


def emit(callback, stage, progress, message, metrics=None, event="progress", **extra):
    item = {"event": event, "stage": stage, "progress": progress, "message": message,
            "timestamp": utc_now(), "metrics": metrics or {}, **extra}
    if callback:
        callback(item)
    return item
