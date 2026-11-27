"""Run with python -m pytest reconstruction/tests/test_bridge.py. No Kaggle jobs are sent."""
import hashlib
import json
from pathlib import Path
import socket
import struct
import threading
import time

import httpx
import pytest
from fastapi.testclient import TestClient
import uvicorn

from reconstruction.bridge.app import Bridge
from reconstruction.bridge.store import Store


class FakeDispatcher:
    def __init__(self):
        self.calls = []

    def submit(self, payload):
        self.calls.append(payload)
        return {"kernel_ref": "local-test/test", "status": "queued"}


@pytest.fixture
def setup(tmp_path):
    dispatcher = FakeDispatcher()
    bridge = Bridge(tmp_path / "runs", "https://worker.example.test", dispatcher)
    with TestClient(bridge.operator) as operator, TestClient(bridge.worker) as worker:
        yield bridge, dispatcher, operator, worker


def upload(bridge, operator):
    r = operator.post("/api/runs", content=b"fake video input", headers={
        "X-Operator-Secret": bridge.store.operator_secret, "X-Filename": "test.mp4"})
    assert r.status_code == 202, r.text
    run_id = r.json()["id"]
    for _ in range(100):
        run = bridge.store.get(run_id)
        if run["dispatch"]:
            return run
        time.sleep(.01)
    raise AssertionError("Dispatch did not finish")


def auth(run):
    return {"Authorization": "Bearer " + run["worker_token"]}


def artifacts():
    binary = struct.pack("<6f8B", 1, 2, 3, .1, .2, .3, 255, 100, 90, 255, 128, 128, 128, 255)
    manifest = {"schema_version": 1, "format": "splat", "artifact": "scene.splat", "bytes": len(binary),
                "sha256": hashlib.sha256(binary).hexdigest(), "gaussian_count": 1}
    return binary, manifest


def test_isolation_and_scoped_authentication(setup):
    bridge, dispatcher, operator, worker = setup
    assert operator.get("/api/runs").status_code == 401
    assert worker.post("/api/runs", content=b"x").status_code == 404
    assert worker.get("/openapi.json").status_code == 404
    run = upload(bridge, operator)
    base = f"/worker/runs/{run['id']}"
    assert worker.get(base + "/video").status_code == 401
    assert worker.get(base + "/video", headers=auth(run)).content == b"fake video input"
    other = upload(bridge, operator)
    assert worker.get(f"/worker/runs/{other['id']}/video", headers=auth(run)).status_code == 401
    assert worker.get("/api/runs", headers={"X-Operator-Secret": bridge.store.operator_secret}).status_code == 404
    assert operator.get("/api/runs", headers={"X-Operator-Secret": bridge.store.operator_secret}).json()[0].get("worker_token") is None
    assert dispatcher.calls[0]["manifest_url"].endswith("/artifacts/run_manifest.json")


@pytest.mark.parametrize("manifest_first", [False, True])
def test_complete_only_after_validated_artifact_pair(setup, manifest_first):
    bridge, _, operator, worker = setup
    run = upload(bridge, operator)
    binary, manifest = artifacts()
    base = f"/worker/runs/{run['id']}/artifacts/"
    pair = [("scene.splat", binary), ("run_manifest.json", json.dumps(manifest).encode())]
    if manifest_first:
        pair.reverse()
    for index, (name, body) in enumerate(pair):
        response = worker.put(base + name, content=body, headers=auth(run))
        assert response.status_code == 200, response.text
        assert (bridge.store.get(run["id"])["status"] == "completed") == (index == 1)
    response = operator.get(f"/api/runs/{run['id']}/artifacts/scene.splat", headers={"X-Operator-Secret": bridge.store.operator_secret})
    assert response.content == binary
    assert worker.get(f"/worker/runs/{run['id']}/video", headers=auth(run)).status_code == 409
    # Worker replay and a late failure cannot regress completed state.
    assert worker.put(base + "scene.splat", content=binary, headers=auth(run)).status_code == 200
    assert worker.post(f"/worker/runs/{run['id']}/progress", json={"status": "failed", "progress": 4}, headers=auth(run)).status_code == 200
    assert bridge.store.get(run["id"])["status"] == "completed"
    assert not list(bridge.store.directory(run["id"]).glob("*.partial"))


def test_reject_corrupt_binary_and_mismatched_manifest(setup):
    bridge, _, operator, worker = setup
    run = upload(bridge, operator)
    binary, manifest = artifacts()
    base = f"/worker/runs/{run['id']}/artifacts/"
    for bad in [b"bad", struct.pack("<6f8B", float("nan"), 2, 3, 1, 1, 1, *([128] * 8))]:
        assert worker.put(base + "scene.splat", content=bad, headers=auth(run)).status_code == 422
    assert worker.put(base + "scene.splat", content=binary, headers=auth(run)).status_code == 200
    manifest["sha256"] = "0" * 64
    assert worker.put(base + "run_manifest.json", json=manifest, headers=auth(run)).status_code == 422
    assert bridge.store.get(run["id"])["status"] != "completed"
    assert not (bridge.store.directory(run["id"]) / "run_manifest.json").exists()


def test_timeout_retry_revokes_token_and_preserves_input(setup):
    bridge, dispatcher, operator, worker = setup
    run = upload(bridge, operator)
    bridge.store.update(run["id"], heartbeat_at=0)
    bridge.store.expire()
    assert bridge.store.get(run["id"])["status"] == "timed_out"
    assert worker.get(f"/worker/runs/{run['id']}/video", headers=auth(run)).status_code == 409
    result = operator.post(f"/api/runs/{run['id']}/retry", headers={"X-Operator-Secret": bridge.store.operator_secret})
    assert result.status_code == 202
    new = bridge.store.get(run["id"])
    assert new["attempt"] == 2
    assert worker.get(f"/worker/runs/{run['id']}/video", headers=auth(run)).status_code == 401
    assert worker.get(f"/worker/runs/{run['id']}/video", headers=auth(new)).content == b"fake video input"


def test_progress_null_and_terminal_control(setup):
    bridge, _, operator, worker = setup
    run = upload(bridge, operator)
    url = f"/worker/runs/{run['id']}/progress"
    for body in [{"stage": "training", "progress": 35}, {"stage": "uploading", "progress": None, "status": "completed"}]:
        assert worker.post(url, json=body, headers=auth(run)).status_code == 200
    current = bridge.store.get(run["id"])
    assert current["progress"] is None
    assert current["status"] == "running"
    assert worker.post(url, json={"progress": 101}, headers=auth(run)).status_code == 422


def test_restart_preserves_active_and_recovers_interrupted_submission(tmp_path):
    bridge = Bridge(tmp_path, "https://worker.example.test", FakeDispatcher())
    active = bridge.store.create("active.mp4")
    interrupted = bridge.store.create("interrupted.mp4")
    bridge.store.update(active["id"], status="running", stage="training", progress=67)
    bridge.store.update(interrupted["id"], status="dispatching")
    reopened = Bridge(tmp_path, "https://worker.example.test", FakeDispatcher())
    with TestClient(reopened.operator):
        assert reopened.store.get(active["id"])["progress"] == 67
        assert reopened.store.get(active["id"])["status"] == "running"
        assert reopened.store.get(interrupted["id"])["status"] == "failed"
        assert reopened.store.operator_secret == bridge.store.operator_secret


def test_upload_limits_and_csrf(setup):
    bridge, _, operator, _ = setup
    key = {"X-Operator-Secret": bridge.store.operator_secret}
    assert operator.post("/api/session", headers=key).status_code == 200
    assert operator.post("/api/runs", content=b"x", headers={"Origin": "https://evil.test"}).status_code == 403
    bridge.max_upload_bytes = 3
    response = operator.post("/api/runs", content=b"toolarge", headers={"X-Filename": "test.mp4"})
    assert response.status_code == 413
    run = bridge.store.list()[0]
    assert run["status"] == "failed"
    assert not list(bridge.store.directory(run["id"]).glob("*.partial"))


def test_dispatch_failure_is_sanitized(tmp_path):
    class Failure:
        def submit(self, payload):
            raise RuntimeError("secret-value-do-not-display")

    bridge = Bridge(tmp_path, "https://worker.example.test", Failure())
    with TestClient(bridge.operator) as operator:
        response = operator.post("/api/runs", content=b"video", headers={
            "X-Operator-Secret": bridge.store.operator_secret, "X-Filename": "test.mp4"})
        run_id = response.json()["id"]
        for _ in range(100):
            run = bridge.store.get(run_id)
            if run["status"] == "failed":
                break
            time.sleep(.01)
        assert run["status"] == "failed"
        assert "secret-value" not in run["error"]
        assert "submission may have succeeded" in run["error"]
        assert operator.get(f"/api/runs/{run_id}", headers={"X-Operator-Secret": bridge.store.operator_secret}).status_code == 200


def finish_without_io(coroutine):
    """Drive an operation with synchronous fake dependencies without creating a socket-based loop."""
    try:
        coroutine.send(None)
    except StopIteration as result:
        return result.value
    finally:
        coroutine.close()
    raise AssertionError("Fake-only operation unexpectedly suspended")


async def immediate_call(function, *args):
    return function(*args)


def test_remote_failure_before_first_worker_callback(tmp_path, monkeypatch):
    class RemoteFailure(FakeDispatcher):
        def status(self, kernel_ref):
            return {"status": "failed"}

    bridge = Bridge(tmp_path, "https://worker.example.test", RemoteFailure())
    run = bridge.store.create("test.mp4")
    bridge.store.update(run["id"], status="queued", dispatch={"kernel_ref": "local-test/test"})
    monkeypatch.setattr("reconstruction.bridge.app.run_in_threadpool", immediate_call)
    finish_without_io(bridge.poll_remote_status())
    current = bridge.store.get(run["id"])
    assert current["status"] == "failed"
    assert "Kaggle reports" in current["error"]


def test_private_retrieval_transient_errors_are_retried_and_sanitized(tmp_path, monkeypatch):
    class FailingDownload(FakeDispatcher):
        def status(self, ref):
            return {"status": "complete"}
        def collect(self, ref, destination):
            raise RuntimeError("private-credential-do-not-display")

    bridge = Bridge(tmp_path, None, FailingDownload())
    run = bridge.store.create("test.mp4")
    bridge.store.update(run["id"], status="running", dispatch={"kernel_ref": "test/test"})
    monkeypatch.setattr("reconstruction.bridge.app.run_in_threadpool", immediate_call)
    for attempt in range(1, 6):
        finish_without_io(bridge.poll_remote_status())
        current = bridge.store.get(run["id"])
        assert current["retrieval_attempts"] == attempt
        assert current["status"] == ("failed" if attempt == 5 else "running")
        assert "private-credential" not in str(current)


def test_private_collection_validates_and_installs_with_fake_only_io(tmp_path, monkeypatch):
    class Complete(FakeDispatcher):
        def status(self, ref):
            return {"status": "complete"}
        def collect(self, ref, destination):
            folder = Path(destination) / "run"
            folder.mkdir(parents=True)
            binary, manifest = artifacts()
            (folder / "scene.splat").write_bytes(binary)
            (folder / "run_manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            return folder

    bridge = Bridge(tmp_path, None, Complete())
    run = bridge.store.create("test.mp4")
    bridge.store.update(run["id"], status="running", dispatch={"kernel_ref": "test/test"})
    monkeypatch.setattr("reconstruction.bridge.app.run_in_threadpool", immediate_call)
    finish_without_io(bridge.poll_remote_status())
    current = bridge.store.get(run["id"])
    assert current["status"] == "completed"
    assert current["artifact"]["gaussian_count"] == 1


@pytest.mark.parametrize("response", [{}, None, {"status": "not-recognized"}])
def test_malformed_remote_status_does_not_change_run(tmp_path, monkeypatch, response):
    class Malformed(FakeDispatcher):
        def status(self, ref):
            return response

    bridge = Bridge(tmp_path, None, Malformed())
    run = bridge.store.create("test.mp4")
    bridge.store.update(run["id"], status="running", dispatch={"kernel_ref": "test/test"})
    monkeypatch.setattr("reconstruction.bridge.app.run_in_threadpool", immediate_call)
    finish_without_io(bridge.poll_remote_status())
    assert bridge.store.get(run["id"])["status"] == "running"


def test_collected_result_install_recovers_after_partial_move(tmp_path, monkeypatch):
    bridge = Bridge(tmp_path / "state", None, FakeDispatcher())
    run = bridge.store.create("test.mp4")
    bridge.store.update(run["id"], status="running")
    output = bridge.store.directory(run["id"]) / "output-1" / "run"
    output.mkdir(parents=True)
    binary, manifest = artifacts()
    (output / "scene.splat").write_bytes(binary)
    (output / "run_manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    import reconstruction.bridge.app as bridge_module

    replace = bridge_module.os.replace
    def fail_manifest(source, target):
        if Path(target) == bridge.store.directory(run["id"]) / "run_manifest.json":
            raise OSError("simulated interruption")
        return replace(source, target)

    monkeypatch.setattr(bridge_module.os, "replace", fail_manifest)
    with pytest.raises(OSError):
        bridge.install_collected_result(run["id"], 1, output)
    assert bridge.store.get(run["id"])["status"] == "running"
    assert (output / "scene.splat").read_bytes() == binary
    assert (output / "bridge-verified.json").is_file()
    monkeypatch.setattr(bridge_module.os, "replace", replace)
    reopened = Bridge(tmp_path / "state", None, FakeDispatcher())
    assert reopened.install_collected_result(run["id"], 1, output)
    assert reopened.store.get(run["id"])["status"] == "completed"
    assert (reopened.store.directory(run["id"]) / "scene.splat").read_bytes() == binary


def test_collected_result_wrong_attempt_cannot_complete(tmp_path):
    bridge = Bridge(tmp_path / "state", None, FakeDispatcher())
    run = bridge.store.create("test.mp4")
    output = tmp_path / "result"
    output.mkdir()
    binary, manifest = artifacts()
    (output / "scene.splat").write_bytes(binary)
    (output / "run_manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    bridge.store.update(run["id"], attempt=2, status="running")
    assert bridge.install_collected_result(run["id"], 1, output) is False
    assert bridge.store.get(run["id"])["status"] == "running"


def test_damaged_operator_secret_rejected(tmp_path):
    (tmp_path / "operator-secret.txt").write_text("", encoding="ascii")
    with pytest.raises(ValueError, match="damaged"):
        Store(tmp_path)


def test_real_http_worker_round_trip(tmp_path):
    """Exercise actual TCP HTTP rather than relying only on in-process ASGI clients."""
    bridge = Bridge(tmp_path, "https://worker.example.test", FakeDispatcher())
    run = bridge.store.create("test.mp4")
    (bridge.store.directory(run["id"]) / "video").write_bytes(b"private input")
    bridge.store.update(run["id"], status="running")
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(bridge.worker, log_level="error"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
    thread.start()
    try:
        for _ in range(200):
            if server.started:
                break
            time.sleep(.01)
        with httpx.Client(base_url=f"http://127.0.0.1:{port}") as client:
            base = f"/worker/runs/{run['id']}"
            assert client.get(base + "/video", headers=auth(run)).content == b"private input"
            binary, manifest = artifacts()
            assert client.put(base + "/artifacts/scene.splat", content=binary, headers=auth(run)).status_code == 200
            result = client.put(base + "/artifacts/run_manifest.json", json=manifest, headers=auth(run))
            assert result.json()["status"] == "completed"
    finally:
        server.should_exit = True
        thread.join(timeout=5)
        listener.close()
    assert not thread.is_alive()
