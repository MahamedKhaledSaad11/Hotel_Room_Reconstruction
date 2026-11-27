<<<<<<< HEAD
# Hotel Room Reconstruction: Backend (FastAPI)

Login, video upload, background 3D reconstruction, 3D viewer URLs, logs, roles and permissions.
Tested: `pytest` (14 tests: auth, validation, permissions, full upload-to-3D flow, command runner).

## Run it
```bash
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                   # then edit SECRET_KEY, ADMIN_PASSWORD, CORS_ORIGINS
uvicorn app.main:app --reload --port 8000
```
- Interactive docs: http://localhost:8000/docs   Health: http://localhost:8000/health
- Default `RUNNER=mock` produces a small fake `.splat` room, so you can test login, upload and the viewer **without a GPU**.
- Tests: `python -m pytest -q`
- Production: set `APP_ENV=production`, a 32+ char `SECRET_KEY`, run behind HTTPS (nginx/Caddy), and `uvicorn app.main:app --workers 1` (the worker thread lives in the process).

## Connect your notebook (real reconstruction)
Set `RUNNER=command` and `RECON_COMMAND` in `.env`. The backend runs it once per video and passes:

| What | How |
|---|---|
| Input video | env `INPUT_VIDEO` (or `{input}` in the command) |
| Output folder | env `OUTPUT_DIR` (or `{output_dir}`); write the 3D file here (`.splat .ksplat .spz .ply .glb .gltf .obj`) |
| Progress (optional) | `print("PROGRESS: 45 Training splats")` |
| Failure | raise an exception / non-zero exit code; the last 15 output lines go to the project logs |

In the first notebook cell:
```python
import os, pathlib
INPUT_VIDEO = os.environ.get("INPUT_VIDEO", "sample.mp4")
OUTPUT_DIR = pathlib.Path(os.environ.get("OUTPUT_DIR", "./out")); OUTPUT_DIR.mkdir(exist_ok=True)
```
Run a notebook: `RECON_COMMAND=jupyter nbconvert --to notebook --execute notebooks/reconstruct.ipynb --output-dir {output_dir} --ExecutePreprocessor.timeout=-1`
Run a script: `RECON_COMMAND=python notebooks/reconstruct.py` (see `notebooks/reconstruct_example.py`).
Notebook on Kaggle/Colab/remote GPU: add a `Runner` subclass in `app/services/runners.py` (one `run(ctx)` method) and register it in `get_runner()`.

## Frontend connection
Copy `frontend_api_example.js`; set `VITE_API_URL=http://localhost:8000` and add your frontend origin to `CORS_ORIGINS`.
Flow: `login` → `upload(name, file)` → `pollProject(id, cb)` → `viewer(id)` → pass `url` to your 3D/splat viewer.
The viewer URL is signed and valid 10 minutes (viewers can't send auth headers), and works only for that project.

## API
| Method & path | Who | Notes |
|---|---|---|
| POST `/api/auth/register` `/login` `/refresh` | public | returns `access_token`, `refresh_token`, `user` |
| POST `/api/auth/logout` `/change-password` | user | revokes all of the user's tokens |
| GET `/api/auth/me` | user | |
| POST `/api/projects` (multipart `name`, `file`) | user | validates type, magic bytes, size; max active jobs per user |
| GET `/api/projects`, `/api/projects/{id}` | owner (admin: `?all=true`) | status: queued, processing, completed, failed, cancelled |
| GET `/api/projects/{id}/logs?after_id=` | owner/admin | job log lines for a progress/log panel |
| POST `/api/projects/{id}/cancel` `/retry`; DELETE `/api/projects/{id}` | owner/admin | |
| GET `/api/projects/{id}/viewer` | owner/admin | `{url, format, expires_in}` |
| GET `/api/admin/users`, PATCH `/api/admin/users/{id}`, GET `/api/admin/audit` | admin | role, disable user, audit trail |

## Errors, logs, security
- Every error: `{"error": {"code", "message", "details", "request_id"}}`. Branch on `code` (`bad_credentials`, `token_expired`, `file_too_large`, `result_not_ready`...). `request_id` is also the `X-Request-ID` header and appears in the logs.
- Logs: JSON lines to console and `data/logs/app.log` (rotating). Per-job logs in the DB. Security events (login, failures, deletes, role changes) in the `audit_logs` table.
- Security: bcrypt passwords, JWT access (30 min) + refresh (7 days), instant revocation on logout, password change or disabling a user, login lockout after 5 failures, other users' projects return 404, upload path sandboxing.
- A server restart re-queues interrupted jobs. Stack traces never reach clients.

## Limits to know
- SQLite and an in-process worker suit a single server. For several servers, use PostgreSQL (`DATABASE_URL`) and a separate worker, and move the login lockout to Redis.
- Registration is open by default; set `ALLOW_REGISTRATION=false` to create users via the admin only.
=======
# Hotel_Room_Reconstruction

The [main frontend](frontend/README.md) handles account access, video upload, reconstruction progress and the interactive 3D result. Run the model using the [reconstruction setup](reconstruction/README.md). Recorded development measurements are in the [validation report](reconstruction/VALIDATION.md).

Backend integration is described in the [service handoff](reconstruction/INTEGRATION.md).
>>>>>>> 236f6b8dda76cf91cd1b974addae174087a17074
