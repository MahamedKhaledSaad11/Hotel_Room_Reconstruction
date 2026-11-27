import logging
import shutil
import threading
from datetime import datetime, timezone

from sqlalchemy import select, update

from ..config import settings
from ..db import SessionLocal
from ..models import JobLog, Project
from . import storage
from .runners import Cancelled, JobContext, RunnerError, get_runner

log = logging.getLogger("app.worker")


def job_log(project_id: str, level: str, message: str) -> None:
    with SessionLocal() as db:
        db.add(JobLog(project_id=project_id, level=level, message=message))
        db.commit()


class Worker:
    def __init__(self) -> None:
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []

    def start(self) -> None:
        if not settings.worker_enabled:
            log.info("worker disabled")
            return
        with SessionLocal() as db:  # recover jobs interrupted by a restart
            n = db.execute(update(Project).where(Project.status == "processing")
                           .values(status="queued", stage="Re-queued after restart", progress=0)).rowcount
            db.commit()
            if n:
                log.warning("re-queued %s interrupted job(s)", n)
        for i in range(max(1, settings.worker_concurrency)):
            t = threading.Thread(target=self._loop, name=f"worker-{i}", daemon=True)
            t.start()
            self._threads.append(t)

    def stop(self) -> None:
        self._stop.set()

    def _claim(self) -> str | None:
        with SessionLocal() as db:
            pid = db.scalar(select(Project.id).where(Project.status == "queued").order_by(Project.created_at).limit(1))
            if not pid:
                return None
            ok = db.execute(update(Project).where(Project.id == pid, Project.status == "queued")
                            .values(status="processing", stage="Starting", progress=0, error=None)).rowcount
            db.commit()
            return pid if ok else None

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                pid = self._claim()
                if pid:
                    self._process(pid)
                else:
                    self._stop.wait(settings.worker_poll_sec)
            except Exception:
                log.exception("worker loop error")
                self._stop.wait(2)

    def _set(self, pid: str, **vals) -> None:
        with SessionLocal() as db:
            db.execute(update(Project).where(Project.id == pid).values(updated_at=datetime.now(timezone.utc), **vals))
            db.commit()

    def _process(self, pid: str) -> None:
        with SessionLocal() as db:
            p = db.get(Project, pid)
            video = storage.abs_path(p.video_path)
            db.execute(update(Project).where(Project.id == pid).values(attempts=Project.attempts + 1))
            db.commit()
        out = storage.result_dir(pid)
        for f in out.iterdir():  # clean leftovers from earlier attempts
            shutil.rmtree(f, ignore_errors=True) if f.is_dir() else f.unlink()

        def is_cancelled() -> bool:
            with SessionLocal() as db:
                return db.scalar(select(Project.status).where(Project.id == pid)) == "cancelled"

        def progress(pct: int, stage: str) -> None:
            with SessionLocal() as db:  # never overwrite a cancel
                db.execute(update(Project).where(Project.id == pid, Project.status == "processing")
                           .values(progress=pct, stage=stage, updated_at=datetime.now(timezone.utc)))
                db.commit()

        ctx = JobContext(pid, video, out, progress, lambda lv, m: job_log(pid, lv, m), is_cancelled)
        job_log(pid, "INFO", "Job started")
        try:
            get_runner().run(ctx)
            rel = storage.find_result(pid)
            if not rel:
                raise RunnerError("Reconstruction finished but produced no 3D file (.splat/.ply/.glb)")
            self._set(pid, status="completed", stage="Done", progress=100, result_path=rel, error=None)
            job_log(pid, "INFO", f"Job completed: {rel}")
        except Cancelled:
            self._set(pid, status="cancelled", stage="Cancelled")
            job_log(pid, "WARNING", "Job cancelled")
        except RunnerError as e:
            self._set(pid, status="failed", stage="Failed", error=str(e))
            job_log(pid, "ERROR", str(e))
        except Exception:
            log.exception("job %s crashed", pid)
            self._set(pid, status="failed", stage="Failed", error="Internal processing error. Please try again.")
            job_log(pid, "ERROR", "Internal processing error (see server logs)")


worker = Worker()
