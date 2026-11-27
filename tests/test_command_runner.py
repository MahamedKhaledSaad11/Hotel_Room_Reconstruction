import sys
from pathlib import Path

from app.config import settings
from app.services import runners
from app.services.runners import CommandRunner, JobContext, RunnerError
import pytest


def _ctx(tmp_path, logs):
    return JobContext("p", tmp_path / "v.mp4", tmp_path, lambda p, s: logs.append((p, s)),
                      lambda lv, m: logs.append((lv, m)), lambda: False)


def test_command_success(tmp_path):
    object.__setattr__(settings, "recon_command", f"{sys.executable} notebooks/reconstruct_example.py")
    logs = []
    CommandRunner().run(_ctx(tmp_path, logs))
    assert (tmp_path / "scene.ply").exists() and (60, "Training splats") in logs


def test_command_failure(tmp_path):
    object.__setattr__(settings, "recon_command", f'{sys.executable} -c "import sys; print(\'boom\'); sys.exit(3)"')
    with pytest.raises(RunnerError, match="exit code 3"):
        CommandRunner().run(_ctx(tmp_path, []))
