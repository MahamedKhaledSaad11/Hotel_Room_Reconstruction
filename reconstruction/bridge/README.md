# Reference reconstruction API

Run from the repository root after installing the reconstruction dependencies. The default sends one private input dataset to your own Kaggle account, starts a private notebook and polls its status and logs. Downloads are verified before becoming available. Kaggle retains the dataset and kernel in your account until you remove them.

```powershell
python -m reconstruction.bridge
```

For an existing HTTPS callback service, start the bridge in callback mode instead:

```powershell
python -m reconstruction.bridge --public-url https://YOUR-WORKER-TUNNEL
```

When callback mode is used, forward HTTPS only to http://127.0.0.1:8766. The operator API is bound to 127.0.0.1:8765. Its secret is stored in operator-secret.txt under the storage directory. Pass it using X-Operator-Secret. The API accepts raw video uploads, reports saved task status and serves verified artifacts. The main frontend uses the production backend's API contract. This bridge remains a reference API for backend development.

Default state lives in `reconstruction/runs/bridge/`. Each run has a readable `run.json`, private source `video`, and completed artifacts. The directory also holds `operator-secret.txt`; keep the directory private because it contains source videos and authentication credentials. Start only one bridge process per storage directory. Run records are written with flush, fsync, and atomic replacement. Restart using the same storage directory and tunnel URL. Active workers can resume callbacks; interrupted uploads/submissions become actionable failures rather than triggering duplicate submissions.

Failed and timed out runs can be retried through `POST /api/runs/{id}/retry`. Retry preserves the input, archives old artifacts, increments the attempt, and revokes the previous worker token. Before retrying an ambiguous Kaggle submission, inspect the Kaggle kernel list to avoid duplicate compute. Its defaults allow 30 minutes without worker activity and six hours per attempt. Adjust `--heartbeat-timeout` and `--max-runtime` for your workload. Kaggle failure status is checked every minute.

In private storage mode, a temporary output-download failure retries automatically up to five times. Retrying a remote kernel that has already completed resumes output retrieval and verification without launching another kernel. Verified downloaded originals are retained so a restart during local installation can finish safely.

Worker contract, always using `Authorization: Bearer <attempt token>`:

| Method | Path | Body / result |
| --- | --- | --- |
| GET | `/worker/runs/{id}/video` | Private source; unavailable after completion |
| POST | `/worker/runs/{id}/progress` | JSON `stage`, `progress` (0–100 or null), optional `message`, `status`, `error` |
| PUT | `/worker/runs/{id}/artifacts/scene.splat` | Binary 32-byte Gaussian records |
| PUT | `/worker/runs/{id}/artifacts/run_manifest.json` | JSON schema below plus optional metrics |

```json
{
  "schema_version": 1,
  "format": "splat",
  "artifact": "scene.splat",
  "sha256": "lowercase SHA-256 of the uploaded scene.splat",
  "bytes": 320,
  "gaussian_count": 10
}
```

The two artifact uploads may arrive in either order. A run completes only after a nonempty `.splat` passes record-size, finite position, positive finite scale, byte count, Gaussian count, and hash checks against the manifest. A progress message claiming completion cannot complete a run. Duplicate artifact requests after completion return success without writing another file. Upload limits default to 4 GiB for input/artifact and 1 MiB for the manifest.

Local operator API uses the `X-Operator-Secret` header or the HttpOnly, SameSite=Strict operator cookie: `POST /api/session`, `POST /api/runs` (raw video bytes plus `X-Filename`), `GET /api/runs`, `GET /api/runs/{id}`, `POST /api/runs/{id}/retry`, and `GET /api/runs/{id}/artifacts/{name}`. Worker tokens never appear in these JSON responses. Cross-origin browser operator requests are rejected.

Verification: `python -m pytest reconstruction/tests/test_bridge.py -q`. Tests use fake dispatchers and include actual localhost HTTP; they never submit external jobs. Windows sandbox environments must allow Python's local socket pair and loopback listener.

Implementation references: [FastAPI request streaming](https://fastapi.tiangolo.com/advanced/using-request-directly/), [Starlette requests](https://www.starlette.io/requests/), [Uvicorn deployment](https://www.uvicorn.org/deployment/), [Python atomic replacement](https://docs.python.org/3/library/os.html#os.replace).
