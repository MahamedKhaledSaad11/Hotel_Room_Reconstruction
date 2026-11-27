import asyncio
import json
from pathlib import Path

from reconstruction.bridge.app import Bridge
from reconstruction.bridge.store import validate_splat
from reconstruction.kaggle.launcher import KaggleDispatcher
from reconstruction.kaggle.private import PrivateDispatcher
from unittest.mock import Mock, patch
import struct
import subprocess
import pytest


def test_standalone_submission_packages_no_callback_or_account_tokens(tmp_path):
    dispatcher = KaggleDispatcher(username="operator", dispatch_root=tmp_path)
    folder, _ = dispatcher.prepare(None, "operator/private-input")
    metadata = json.loads((folder / "kernel-metadata.json").read_text())
    assert metadata["is_private"] is True
    assert metadata["dataset_sources"] == ["operator/private-input"]
    notebook = json.loads((folder / "reconstruction.ipynb").read_text())
    configuration = {}
    exec("".join(notebook["cells"][1]["source"]), configuration)
    assert configuration["CONFIG"]["payload"] is None


def test_kaggle_logs_deliver_actual_reported_training_iteration():
    response = Mock(returncode=0, stdout='10s {"event":"progress","stage":"training_3dgs","progress":50,"message":"3500/7000"}\n15s other output')
    with patch("subprocess.run", return_value=response):
        result = PrivateDispatcher(username="operator").last_progress("operator/room")
    assert result == {"stage": "training_3dgs", "progress": 50, "message": "3500/7000"}


@pytest.mark.parametrize("binary", [True, False])
def test_live_log_timeout_keeps_last_reported_progress(binary):
    log = '{"event":"progress","stage":"estimating_poses","progress":null,"message":"Matching"}'
    output = log.encode() if binary else log
    with patch("subprocess.run", side_effect=subprocess.TimeoutExpired("kaggle", 8, output=output)):
        assert PrivateDispatcher(username="operator").last_progress("operator/room")["stage"] == "estimating_poses"


def test_private_run_download_is_verified_before_completion(tmp_path):
    dispatcher = Mock()
    dispatcher.submit_video.return_value = {"kernel_ref": "operator/room", "dataset_ref": "operator/video"}
    dispatcher.status.return_value = {"status": "complete"}
    bridge = Bridge(tmp_path, None, dispatcher)
    run = bridge.store.create("room.mp4")
    (bridge.store.directory(run["id"]) / "video").write_bytes(b"input")
    output = tmp_path / "download" / "run"
    output.mkdir(parents=True)
    (output / "scene.splat").write_bytes(struct.pack("<6f8B", 0, 0, 1, 1, 1, 1, 0, 0, 255, 255, 255, 128, 128, 128))
    info = validate_splat(output / "scene.splat")
    manifest = dict(info, format="splat", artifact="scene.splat", schema_version=1)
    (output / "run_manifest.json").write_text(json.dumps(manifest))
    dispatcher.collect.return_value = output
    asyncio.run(bridge.dispatch(run["id"]))
    assert bridge.store.get(run["id"])["status"] == "queued"
    asyncio.run(bridge.poll_remote_status())
    assert bridge.store.get(run["id"])["status"] == "completed"
    assert (bridge.store.directory(run["id"]) / "scene.splat").stat().st_size == 32
