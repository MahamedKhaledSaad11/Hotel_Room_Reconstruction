"""Dry contract tests. No Kaggle authentication, push, upload, or GPU is used."""
import base64
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import Mock, patch
import urllib.error

from reconstruction.kaggle.launcher import DispatchError, KaggleDispatcher, build_notebook, source_archive
from reconstruction.kaggle.worker import BridgeClient, WorkerError, run, validate_payload


def payload():
    root = "https://bridge.example/worker/runs/test-run"
    return {"run_id": "test-run", "attempt": 1, "input_url": root + "/video",
            "progress_url": root + "/progress", "artifact_url": root + "/artifacts/scene.splat",
            "manifest_url": root + "/artifacts/run_manifest.json", "token": "scoped-test-secret"}


def source_fixture(root):
    for name in ("__init__.py", "pipeline/__init__.py", "pipeline/__main__.py", "pipeline/train.py",
                 "kaggle/__init__.py", "kaggle/worker.py", "kaggle/setup_environment.py"):
        path = root / "reconstruction" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("# minimal test source\n")
    for name in (".runtime/credentials.py", ".runtime/env/Lib/site-packages/secret.py",
                 "bridge/config.py", "tests/private.py", "pipeline/cache/private.py"):
        path = root / "reconstruction" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("NEVER_UPLOAD_THIS_CREDENTIAL = 'long-lived-secret'\n")


class KaggleContractTests(unittest.TestCase):
    def test_source_allowlist_excludes_runtime_and_unrelated_python_without_recursive_glob(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source_fixture(root)
            with patch.object(Path, "rglob", side_effect=AssertionError("Recursive traversal forbidden")):
                first = source_archive(root)
                second = source_archive(root)
            self.assertEqual(first, second)
            with tarfile.open(fileobj=io.BytesIO(base64.b64decode(first))) as archive:
                names = archive.getnames()
                self.assertEqual(len(names), 7)
                self.assertIn("reconstruction/pipeline/__main__.py", names)
                for member in archive.getmembers():
                    self.assertNotIn(b"NEVER_UPLOAD", archive.extractfile(member).read())
                self.assertFalse(any(".runtime" in name or "/bridge/" in name or "/cache/" in name for name in names))

    def test_notebook_code_compiles_and_standalone_has_no_credentials(self):
        notebook = build_notebook(embed_source=False)
        for cell in notebook["cells"]:
            if cell["cell_type"] == "code":
                compile("".join(cell["source"]), "notebook-cell", "exec")
                self.assertEqual(cell["outputs"], [])
        text = json.dumps(notebook)
        self.assertNotIn("scoped-test-secret", text)
        self.assertNotIn("KAGGLE_KEY", text)

    def test_dispatch_private_immutable_metadata_and_cleanup(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source_fixture(root)
            dispatcher = KaggleDispatcher(username="owner", dispatch_root=root / "dispatch", project_root=root)
            folder_a, result_a = dispatcher.prepare(payload())
            folder_b, result_b = dispatcher.prepare(payload())
            self.assertNotEqual(result_a["kernel_ref"], result_b["kernel_ref"])
            metadata = json.loads((folder_a / "kernel-metadata.json").read_text())
            self.assertTrue(metadata["is_private"])
            self.assertTrue(metadata["enable_internet"])
            self.assertEqual(metadata["machine_shape"], "NvidiaTeslaT4")
            with patch("reconstruction.kaggle.launcher.subprocess.run", return_value=subprocess.CompletedProcess([], 0, "Kernel version successfully pushed", "")) as cli:
                result = dispatcher.submit(payload())
            self.assertEqual(cli.call_args.args[0][1:3], ["kernels", "push"])
            self.assertIn("--accelerator", cli.call_args.args[0])
            self.assertNotIn("token", result)
            self.assertFalse((root / "dispatch" / result["dispatch_id"] / "reconstruction.ipynb").exists())

    def test_push_timeout_is_not_retried_and_exposes_kernel_for_reconciliation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source_fixture(root)
            dispatcher = KaggleDispatcher(username="owner", dispatch_root=root / "dispatch", project_root=root)
            with patch("reconstruction.kaggle.launcher.subprocess.run", side_effect=subprocess.TimeoutExpired("kaggle", 180)) as cli:
                with self.assertRaisesRegex(DispatchError, "dispatch uncertain for owner/reconstruction-"):
                    dispatcher.submit(payload())
            self.assertEqual(cli.call_count, 1)
            self.assertFalse(list((root / "dispatch").glob("*/reconstruction.ipynb")))

    def test_status_accepts_cli_enum_and_terminal_failures(self):
        dispatcher = KaggleDispatcher(username="owner")
        for raw, expected in (("KernelWorkerStatus.COMPLETE", "complete"), ("running", "running"),
                              ("KernelWorkerStatus.ERROR", "failed"), ("queued", "queued")):
            with self.subTest(raw=raw), patch("reconstruction.kaggle.launcher.subprocess.run",
                    return_value=subprocess.CompletedProcess([], 0, f'owner/test has status "{raw}"', "")):
                self.assertEqual(dispatcher.status("owner/test")["status"], expected)

    def test_worker_urls_require_one_https_origin(self):
        for change in ({"input_url": "http://bridge.example/video"},
                       {"manifest_url": "https://attacker.example/manifest"},
                       {"input_url": "https://user:password@bridge.example/video"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_payload({**payload(), **change})

    def test_retry_download_restarts_and_unauthorized_does_not_retry(self):
        client = BridgeClient(payload())
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.side_effect = [b"video-data", b""]
        client.opener.open = Mock(side_effect=[urllib.error.URLError("offline"), response])
        with tempfile.TemporaryDirectory() as temp, patch("reconstruction.kaggle.worker.time.sleep"):
            target = Path(temp) / "input.mp4"
            client.download(target)
            self.assertEqual(target.read_bytes(), b"video-data")
            self.assertFalse(target.with_suffix(".mp4.part").exists())
        self.assertEqual(client.opener.open.call_count, 2)
        client.opener.open = Mock(side_effect=urllib.error.HTTPError("", 401, "unauthorized", {}, None))
        with self.assertRaisesRegex(WorkerError, "HTTP 401"):
            client.progress({"stage": "training_3dgs", "progress": 40})
        self.assertEqual(client.opener.open.call_count, 1)

    def test_upload_preserves_geometry_and_includes_real_artifact_hash_and_metrics(self):
        client = BridgeClient(payload())
        client._request = Mock()
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            binary = b"x" * 64
            (output / "scene.splat").write_bytes(binary)
            (output / "run_manifest.json").write_text(json.dumps({"initial_camera": {"position": [1, 2, 3]}}))
            (output / "training_metrics.json").write_text(json.dumps({"iterations": 7000}))
            manifest = client.upload(output)
            self.assertEqual(manifest["sha256"], hashlib.sha256(binary).hexdigest())
            self.assertEqual(manifest["gaussian_count"], 2)
            self.assertEqual(manifest["initial_camera"]["position"], [1, 2, 3])
            self.assertEqual(manifest["metrics"]["training_metrics"]["iterations"], 7000)
            self.assertEqual([call.args[0] for call in client._request.call_args_list], ["artifact_url", "manifest_url"])

    def test_pipeline_failure_reports_scoped_failure_and_never_uploads(self):
        fake_client = Mock()
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            video = output / "input.mp4"
            video.write_bytes(b"dummy")
            fake_client.download.return_value = video
            process = Mock()
            process.stdout = iter(['{"event":"progress","stage":"training_3dgs","progress":25}\n'])
            process.wait.return_value = 3
            process.__enter__ = Mock(return_value=process)
            process.__exit__ = Mock(return_value=False)
            with patch("reconstruction.kaggle.worker.BridgeClient", return_value=fake_client), \
                 patch("reconstruction.kaggle.worker.subprocess.Popen", return_value=process):
                with self.assertRaisesRegex(WorkerError, "code 3"):
                    run(payload=payload(), output=output)
            fake_client.upload.assert_not_called()
            self.assertTrue(any(call.args[0].get("event") == "failed" for call in fake_client.progress.call_args_list))


if __name__ == "__main__":
    unittest.main()
