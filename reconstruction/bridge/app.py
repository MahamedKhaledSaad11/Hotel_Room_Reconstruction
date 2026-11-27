"""Reference operator API on loopback and scoped worker callbacks."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import hmac
import json
import os
from pathlib import Path
import secrets
import shutil
import time
from urllib.parse import urlparse, unquote

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool

from .store import Store, TERMINAL, atomic_json, validate_splat, verify_manifest


def public_run(run: dict) -> dict:
    return {key: value for key, value in run.items() if key != "worker_token"}


class Bridge:
    def __init__(self, root: Path, public_url: str | None, dispatcher, *, timeout: int = 1800,
                 max_runtime: int = 21600, max_upload_bytes: int = 4 * 1024**3):
        parsed = urlparse(public_url or "")
        if public_url is not None and (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.query or parsed.fragment):
            raise ValueError("public_url must be an HTTPS worker tunnel URL without credentials, query, or fragment.")
        self.store = Store(root, timeout, max_runtime)
        self.public_url = public_url.rstrip("/") if public_url else None
        self.dispatcher = dispatcher
        self.max_upload_bytes = max_upload_bytes
        self.tasks: set[asyncio.Task] = set()
        self.last_status_check = 0.0
        self.operator = self._operator_app()
        self.worker = self._worker_app()

    def track(self, coro) -> None:
        task = asyncio.create_task(coro)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def dispatch(self, run_id: str) -> None:
        with self.store.lock:
            run = self.store.get(run_id)
            self.store.update(run_id, status="dispatching", stage="dispatching", heartbeat_at=time.time())
        base = f"{self.public_url}/worker/runs/{run_id}"
        payload = {"run_id": run_id, "attempt": run["attempt"], "input_url": base + "/video",
                   "progress_url": base + "/progress", "artifact_url": base + "/artifacts/scene.splat",
                   "manifest_url": base + "/artifacts/run_manifest.json", "token": run["worker_token"]}
        try:
            if self.public_url:
                submission = asyncio.create_task(run_in_threadpool(self.dispatcher.submit, payload))
            else:
                submission = asyncio.create_task(run_in_threadpool(self.dispatcher.submit_video, self.store.directory(run_id) / "video"))
            while not submission.done():
                await asyncio.wait({submission}, timeout=30)
                with self.store.lock:
                    current = self.store.get(run_id)
                    if current["attempt"] == run["attempt"] and current["status"] not in TERMINAL:
                        self.store.update(run_id, heartbeat_at=time.time())
            result = await submission
            with self.store.lock:
                current = self.store.get(run_id)
                if current["attempt"] == run["attempt"] and current["status"] not in TERMINAL:
                    changes = {"dispatch": result}
                    if current["status"] == "dispatching":
                        changes.update(status="queued", stage="queued")
                    self.store.update(run_id, **changes)
        except Exception as exc:
            with self.store.lock:
                current = self.store.get(run_id)
                if current["attempt"] == run["attempt"] and current["status"] not in TERMINAL:
                    # CLI failures can include embedded credentials. Keep the user-facing error sanitized.
                    self.store.update(run_id, status="failed", error=(
                        f"Kaggle dispatch failed ({type(exc).__name__}). Check Kaggle credentials, quota and "
                        "the Kaggle kernel list before retrying; submission may have succeeded."))

    async def watchdog(self):
        while True:
            await asyncio.sleep(10)
            self.store.expire()
            if time.monotonic() - self.last_status_check < 60 or not hasattr(self.dispatcher, "status"):
                continue
            self.last_status_check = time.monotonic()
            try:
                await self.poll_remote_status()
            except Exception:
                # One transient status/parsing/storage failure must not permanently stop timeouts and polling.
                continue

    def install_collected_result(self, run_id: str, attempt: int, downloaded: Path) -> bool:
        """Preserve the collected originals so an interrupted two-file install is restartable."""
        artifact = validate_splat(downloaded / "scene.splat")
        verify_manifest(json.loads((downloaded / "run_manifest.json").read_text(encoding="utf-8")), artifact)
        atomic_json(downloaded / "bridge-verified.json", artifact)
        with self.store.lock:
            current = self.store.get(run_id)
            if current["attempt"] != attempt or current["status"] in TERMINAL:
                return False
            folder = self.store.directory(run_id)
            for name in ("scene.splat", "run_manifest.json"):
                target = folder / name
                temporary = target.with_name(name + ".installing")
                with (downloaded / name).open("rb") as source, temporary.open("wb") as output:
                    shutil.copyfileobj(source, output)
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, target)
            self.store.update(run_id, status="completed", stage="completed", artifact=artifact,
                              remote_status="complete", progress=100, heartbeat_at=time.time(), error=None,
                              message="Verified Kaggle output downloaded.")
            return True

    async def poll_remote_status(self):
        for run in self.store.list():
            ref = (run.get("dispatch") or {}).get("kernel_ref")
            if not ref or run["status"] in TERMINAL:
                continue
            try:
                remote = await run_in_threadpool(self.dispatcher.status, ref)
            except Exception:
                continue  # A control-plane outage must not overwrite actual worker progress.
            if not isinstance(remote, dict) or remote.get("status") not in {"queued", "running", "complete", "failed", "unknown"}:
                continue
            updates = {}
            if self.public_url is None and remote["status"] in {"queued", "running", "complete"}:
                updates = {"status": "running" if remote["status"] != "queued" else "queued",
                           "stage": remote["status"], "progress": None, "heartbeat_at": time.time()}
                if remote["status"] == "running":
                    try:
                        event = await run_in_threadpool(self.dispatcher.last_progress, ref)
                        if isinstance(event, dict):
                            for key in ("stage", "message"):
                                if event.get(key) is not None:
                                    updates[key] = str(event[key])[:2000]
                            percent = event.get("progress")
                            updates["progress"] = percent if isinstance(percent, (int, float)) and 0 <= percent <= 100 else None
                    except Exception:
                        pass  # Kaggle may expose status before it exposes its log.
                if remote["status"] == "complete":
                    folder = self.store.directory(run["id"])
                    try:
                        destination = folder / f"output-{run['attempt']}"
                        cached = list(destination.rglob("bridge-verified.json")) if destination.exists() else []
                        if len(cached) == 1:
                            downloaded = cached[0].parent
                        else:
                            downloaded = await run_in_threadpool(self.dispatcher.collect, ref, destination)
                    except Exception:
                        attempts = run.get("retrieval_attempts", 0) + 1
                        updates.update(stage="retrieving_output", retrieval_attempts=attempts,
                                       message="Kaggle completed; output retrieval failed. Retrying automatically.")
                        if attempts >= 5:
                            updates.update(status="failed", error=(
                                "Could not download Kaggle output after five attempts. Check network and kernel outputs, then retry."))
                    else:
                        try:
                            await run_in_threadpool(self.install_collected_result, run["id"], run["attempt"], Path(downloaded))
                        except (ValueError, UnicodeError, FileNotFoundError):
                            updates.update(status="failed", error=(
                                "Kaggle output failed artifact/manifest validation. Inspect kernel outputs before retrying."))
                        except OSError:
                            updates.update(stage="retrieving_output", message=(
                                "Cannot save downloaded output locally. Check free disk space and permissions; retrying automatically."))
                        else:
                            continue
            with self.store.lock:
                current = self.store.get(run["id"])
                if current["attempt"] != run["attempt"] or current["status"] in TERMINAL:
                    continue
                if remote.get("status") == "failed":
                    self.store.update(run["id"], status="failed", error=(
                        "Kaggle reports this kernel failed. Open the kernel page for logs, fix the cause, then retry."))
                else:
                    self.store.update(run["id"], remote_status=remote.get("status", "unknown"), **updates)

    def authorize_operator(self, request: Request) -> None:
        token = request.headers.get("x-operator-secret") or request.cookies.get("operator_session", "")
        if not hmac.compare_digest(token.encode(), self.store.operator_secret.encode()):
            raise HTTPException(401, "Local operator login required.")
        # A secret alone does not defend cookie-authenticated browser requests against CSRF.
        origin = request.headers.get("origin")
        if origin and origin != str(request.base_url).rstrip("/"):
            raise HTTPException(403, "Cross-origin operator requests are forbidden.")

    def authorize_worker(self, request: Request, run_id: str) -> dict:
        try:
            run = self.store.get(run_id)
        except KeyError:
            raise HTTPException(404, "Run not found.")
        token = request.headers.get("authorization", "")
        if not hmac.compare_digest(token.encode(), ("Bearer " + run["worker_token"]).encode()):
            raise HTTPException(401, "Invalid or superseded run token.")
        if run["status"] in {"failed", "timed_out"}:
            raise HTTPException(409, "Run is terminal; retry through the local operator API.")
        return run

    async def receive(self, request: Request, run_id: str, limit: int) -> Path:
        path = self.store.directory(run_id) / ("upload-" + secrets.token_hex(8) + ".partial")
        total = 0
        heartbeat = time.monotonic()
        try:
            with path.open("wb") as stream:
                async for chunk in request.stream():
                    total += len(chunk)
                    if total > limit:
                        raise HTTPException(413, "Upload exceeds configured size limit.")
                    stream.write(chunk)
                    if time.monotonic() - heartbeat >= 5:
                        self.store.update(run_id, heartbeat_at=time.time())
                        heartbeat = time.monotonic()
                stream.flush()
                os.fsync(stream.fileno())
            if not total:
                raise HTTPException(422, "Empty upload.")
            return path
        except BaseException:
            path.unlink(missing_ok=True)
            raise

    def complete_if_ready(self, run_id: str) -> None:
        run = self.store.get(run_id)
        folder = self.store.directory(run_id)
        if run.get("artifact") and (folder / "run_manifest.json").exists():
            manifest = json.loads((folder / "run_manifest.json").read_text(encoding="utf-8"))
            verify_manifest(manifest, run["artifact"])
            self.store.update(run_id, status="completed", stage="completed", progress=100, error=None,
                              heartbeat_at=time.time())

    def _operator_app(self) -> FastAPI:
        @asynccontextmanager
        async def lifespan(app):
            # A dispatched run is never resubmitted automatically after restart: Kaggle push can be ambiguous.
            for run in self.store.list():
                if run["status"] in {"uploading", "dispatching"} or (run["status"] == "queued" and not run.get("dispatch")):
                    self.store.update(run["id"], status="failed", error=(
                        "Bridge restarted during upload/submission. Check the Kaggle kernel list before retrying; "
                        "the submission may already exist."))
            self.store.expire()
            watchdog = asyncio.create_task(self.watchdog())
            yield
            watchdog.cancel()
            await asyncio.gather(watchdog, return_exceptions=True)
            if self.tasks:
                await asyncio.gather(*self.tasks, return_exceptions=True)

        app = FastAPI(title="Local reconstruction operator", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

        @app.post("/api/session")
        async def session(request: Request):
            self.authorize_operator(request)
            response = JSONResponse({"ok": True})
            response.set_cookie("operator_session", self.store.operator_secret, httponly=True,
                                samesite="strict", path="/", max_age=7 * 86400)
            return response

        @app.get("/api/runs")
        def runs(request: Request):
            self.authorize_operator(request)
            self.store.expire()
            return [public_run(run) for run in self.store.list()]

        @app.post("/api/runs", status_code=202)
        async def create(request: Request):
            self.authorize_operator(request)
            filename = unquote(request.headers.get("x-filename", "video.mp4"))
            if Path(filename).suffix.lower() not in {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"}:
                raise HTTPException(422, "Choose a supported video file.")
            run = self.store.create(filename)
            path = None
            try:
                path = await self.receive(request, run["id"], self.max_upload_bytes)
                path.replace(self.store.directory(run["id"]) / "video")
                self.store.update(run["id"], status="queued", stage="queued", heartbeat_at=time.time())
            except BaseException:
                self.store.update(run["id"], status="failed", error="Video upload interrupted or rejected. Upload again.")
                raise
            self.track(self.dispatch(run["id"]))
            return public_run(self.store.get(run["id"]))

        @app.get("/api/runs/{run_id}")
        def get_run(run_id: str, request: Request):
            self.authorize_operator(request)
            self.store.expire()
            try:
                return public_run(self.store.get(run_id))
            except KeyError:
                raise HTTPException(404, "Run not found.")

        @app.post("/api/runs/{run_id}/retry", status_code=202)
        async def retry(run_id: str, request: Request):
            self.authorize_operator(request)
            try:
                current = self.store.get(run_id)
                if (self.public_url is None and current["status"] in {"failed", "timed_out"}
                        and current.get("remote_status") == "complete" and current.get("dispatch")):
                    run = self.store.update(run_id, status="running", stage="retrieving_output", error=None,
                                            retrieval_attempts=0, heartbeat_at=time.time(), attempt_started_at=time.time())
                    self.track(self.poll_remote_status())
                    return public_run(run)
                run = self.store.retry(run_id)
            except KeyError:
                raise HTTPException(404, "Run not found.")
            except ValueError as exc:
                raise HTTPException(409, str(exc))
            self.track(self.dispatch(run_id))
            return public_run(run)

        @app.get("/api/runs/{run_id}/artifacts/{name}")
        def download(run_id: str, name: str, request: Request):
            self.authorize_operator(request)
            try:
                run = self.store.get(run_id)
            except KeyError:
                raise HTTPException(404, "Run not found.")
            if run["status"] != "completed" or name not in {"scene.splat", "run_manifest.json"}:
                raise HTTPException(404, "Verified artifact not available.")
            return FileResponse(self.store.directory(run_id) / name, filename=name)

        return app

    def _worker_app(self) -> FastAPI:
        app = FastAPI(title="Reconstruction worker callbacks", docs_url=None, redoc_url=None, openapi_url=None)

        @app.get("/health")
        def health():
            return {"ok": True}

        @app.get("/worker/runs/{run_id}/video")
        def video(run_id: str, request: Request):
            run = self.authorize_worker(request, run_id)
            if run["status"] == "completed":
                raise HTTPException(409, "Completed runs no longer expose their source video to workers.")
            path = self.store.directory(run_id) / "video"
            if not path.exists():
                raise HTTPException(409, "Video upload is incomplete.")
            return FileResponse(path, media_type="application/octet-stream", filename="input.mp4")

        @app.post("/worker/runs/{run_id}/progress")
        async def progress(run_id: str, request: Request):
            self.authorize_worker(request, run_id)
            raw = bytearray()
            async for chunk in request.stream():
                raw.extend(chunk)
                if len(raw) > 16384:
                    raise HTTPException(413, "Progress body too large.")
            try:
                body = json.loads(raw)
                percent = float(body.get("progress") or 0)
                if not 0 <= percent <= 100 or body.get("status", "running") not in {"running", "failed", "completed"}:
                    raise ValueError()
            except (ValueError, TypeError, AttributeError):
                raise HTTPException(422, "Invalid progress JSON.")
            with self.store.lock:
                run = self.authorize_worker(request, run_id)
                if run["status"] == "completed":
                    return {"ok": True, "status": "completed"}
                changes = {"heartbeat_at": time.time(), "status": "running",
                           "stage": str(body.get("stage", "running"))[:120], "progress": min(percent, 99) if body.get("progress") is not None else None,
                           "message": str(body.get("message", ""))[:2000]}
                if body.get("status") == "failed":
                    changes.update(status="failed", error=str(body.get("error", body.get("message", "Worker failed.")))[:4000])
                self.store.update(run_id, **changes)
            return {"ok": True}

        @app.put("/worker/runs/{run_id}/artifacts/{name}")
        async def artifact(run_id: str, name: str, request: Request):
            run = self.authorize_worker(request, run_id)
            if name not in {"scene.splat", "run_manifest.json"}:
                raise HTTPException(404, "Unknown artifact.")
            if run["status"] == "completed":
                return {"ok": True, "status": "completed"}
            path = await self.receive(request, run_id, self.max_upload_bytes if name == "scene.splat" else 1024**2)
            try:
                info = await run_in_threadpool(validate_splat, path) if name == "scene.splat" else None
                manifest = json.loads(path.read_text(encoding="utf-8")) if info is None else None
                with self.store.lock:
                    run = self.authorize_worker(request, run_id)
                    if run["status"] == "completed":
                        return {"ok": True, "status": "completed"}
                    folder = self.store.directory(run_id)
                    if info and (folder / "run_manifest.json").exists():
                        verify_manifest(json.loads((folder / "run_manifest.json").read_text(encoding="utf-8")), info)
                    if manifest is not None:
                        if not isinstance(manifest, dict):
                            raise ValueError("Manifest must be a JSON object.")
                        # Validate mandatory shape even when manifest arrives before binary.
                        if not all(key in manifest for key in ("bytes", "sha256", "gaussian_count")):
                            raise ValueError("Manifest is missing artifact verification fields.")
                        verify_manifest(manifest, run.get("artifact") or {key: manifest[key] for key in ("bytes", "sha256", "gaussian_count")})
                    path.replace(folder / name)
                    changes = {"heartbeat_at": time.time(), "stage": "receiving_artifacts"}
                    if info:
                        changes["artifact"] = info
                    self.store.update(run_id, **changes)
                    self.complete_if_ready(run_id)
                    return {"ok": True, "status": self.store.get(run_id)["status"]}
            except (ValueError, UnicodeError) as exc:
                raise HTTPException(422, str(exc))
            finally:
                path.unlink(missing_ok=True)

        return app
