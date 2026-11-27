"""Reconstruction runners. The worker only knows the Runner interface:

    run(ctx) -> None     # must leave a 3D file (.splat/.ply/.glb...) inside ctx.output_dir

Add your own (e.g. Kaggle API, Modal, remote GPU) by subclassing Runner and registering it in get_runner().
"""
import os
import queue
import random
import re
import shlex
import struct
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from ..config import settings


class RunnerError(Exception):
    """Failure with a message that is safe to show to the user."""


class Cancelled(Exception):
    pass


@dataclass
class JobContext:
    project_id: str
    video_path: Path
    output_dir: Path
    progress: Callable[[int, str], None]
    log: Callable[[str, str], None]          # (level, message)
    is_cancelled: Callable[[], bool]

    def check(self) -> None:
        if self.is_cancelled():
            raise Cancelled()


class Runner:
    def run(self, ctx: JobContext) -> None:
        raise NotImplementedError


class MockRunner(Runner):
    """No GPU needed: writes a small valid .splat (a box-shaped 'room') so the whole stack and viewer can be tested."""
    STEPS = [(10, "Extracting frames"), (30, "Estimating camera poses"), (60, "Training Gaussian splats"),
             (90, "Exporting splat"), (100, "Done")]

    def run(self, ctx: JobContext) -> None:
        for pct, stage in self.STEPS:
            ctx.check()
            ctx.progress(pct, stage)
            ctx.log("INFO", f"[mock] {stage}")
            time.sleep(settings.mock_step_delay)
        rnd = random.Random(7)
        buf = bytearray()
        for _ in range(4000):
            axis = rnd.randrange(3)
            p = [rnd.uniform(-2, 2), rnd.uniform(-1.2, 1.2), rnd.uniform(-2, 2)]
            p[axis] = rnd.choice((-1, 1)) * (2 if axis != 1 else 1.2)
            col = [int(120 + 80 * (c + 2) / 4) for c in p]
            buf += struct.pack("<3f3f4B4B", *p, 0.03, 0.03, 0.03, col[0] % 256, col[1] % 256, col[2] % 256, 255,
                               255, 128, 128, 128)
        (ctx.output_dir / "scene.splat").write_bytes(bytes(buf))


class CommandRunner(Runner):
    """Runs any command (notebook via nbconvert, python script, docker...). The notebook/script contract:

      * input video path  -> env INPUT_VIDEO   (also {input} in the command)
      * output directory  -> env OUTPUT_DIR    (also {output_dir}); write the 3D file in there
      * optional progress -> print 'PROGRESS: 45 Training splats' to stdout
      * non-zero exit code = failure
    """
    PROGRESS_RE = re.compile(r"^PROGRESS:\s*(\d{1,3})\s*(.*)$")
    MAX_LOG_LINES = 2000

    def run(self, ctx: JobContext) -> None:
        if not settings.recon_command:
            raise RunnerError("Reconstruction is not configured (RECON_COMMAND is empty)")
        cmd = [a.format(input=str(ctx.video_path), output_dir=str(ctx.output_dir))
               for a in shlex.split(settings.recon_command, posix=os.name != "nt")]
        env = {**os.environ, "INPUT_VIDEO": str(ctx.video_path), "OUTPUT_DIR": str(ctx.output_dir),
               "PYTHONUNBUFFERED": "1"}
        ctx.log("INFO", f"Starting: {' '.join(cmd)}")
        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                    env=env, errors="replace")
        except FileNotFoundError:
            raise RunnerError(f"Command not found: {cmd[0]}")
        lines: "queue.Queue[str|None]" = queue.Queue()

        def reader():
            for ln in proc.stdout:  # type: ignore[union-attr]
                lines.put(ln.rstrip())
            lines.put(None)

        threading.Thread(target=reader, daemon=True).start()
        start, n, tail, done = time.time(), 0, [], False
        while not done:
            try:
                ln = lines.get(timeout=0.5)
                if ln is None:
                    done = True
                else:
                    m = self.PROGRESS_RE.match(ln)
                    if m:
                        ctx.progress(min(int(m.group(1)), 99), m.group(2) or "Processing")
                    elif ln:
                        tail = (tail + [ln])[-15:]
                        n += 1
                        if n <= self.MAX_LOG_LINES:
                            ctx.log("INFO", ln[:500])
                        elif n == self.MAX_LOG_LINES + 1:
                            ctx.log("WARNING", "Log output truncated")
            except queue.Empty:
                pass
            if ctx.is_cancelled() or time.time() - start > settings.job_timeout_sec:
                proc.terminate()
                try:
                    proc.wait(10)
                except subprocess.TimeoutExpired:
                    proc.kill()
                if ctx.is_cancelled():
                    raise Cancelled()
                raise RunnerError("Reconstruction timed out")
        code = proc.wait()
        if code != 0:
            ctx.log("ERROR", "Last output:\n" + "\n".join(tail))
            raise RunnerError(f"Reconstruction failed (exit code {code}). See project logs.")


def get_runner() -> Runner:
    if settings.runner == "mock":
        return MockRunner()
    if settings.runner == "command":
        return CommandRunner()
    raise RuntimeError(f"Unknown RUNNER '{settings.runner}'")
