import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text

from . import errors
from .config import settings
from .db import Base, SessionLocal, engine
from .logging_conf import setup_logging
from .models import User
from .routers import admin, auth, projects
from .security import hash_password
from .services import storage
from .services.worker import worker

log = logging.getLogger("app")


def bootstrap_admin() -> None:
    if not (settings.admin_email and settings.admin_password):
        return
    with SessionLocal() as db:
        email = settings.admin_email.lower()
        if not db.scalar(select(User).where(User.email == email)):
            db.add(User(email=email, name="Admin", role="admin", password_hash=hash_password(settings.admin_password)))
            db.commit()
            log.info("created admin user %s", email)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.validate()
    setup_logging()
    storage.root()
    Base.metadata.create_all(engine)
    bootstrap_admin()
    worker.start()
    log.info("backend started env=%s runner=%s", settings.env, settings.runner)
    yield
    worker.stop()


app = FastAPI(title="Hotel Room Reconstruction API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"], expose_headers=["X-Request-ID"])
errors.install(app)


@app.middleware("http")
async def request_log(request: Request, call_next):
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    request.state.request_id = rid
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        log.exception("unhandled", extra={"request_id": rid, "path": request.url.path})
        raise
    response.headers["X-Request-ID"] = rid
    log.info("request", extra={"request_id": rid, "method": request.method, "path": request.url.path,
                               "status": response.status_code, "ms": round((time.perf_counter() - start) * 1000, 1),
                               "user_id": getattr(request.state, "user_id", None)})
    return response


app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(admin.router)


@app.get("/health", tags=["meta"])
def health():
    with SessionLocal() as db:
        db.execute(text("SELECT 1"))
    return {"status": "ok", "runner": settings.runner, "worker": settings.worker_enabled}
