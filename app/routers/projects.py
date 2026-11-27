from datetime import timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import current_user, get_project_for, user_from_token
from ..errors import AppError
from ..models import JobLog, Project, User
from ..schemas import LogOut, ProjectOut, ViewerOut
from ..security import create_token, decode_token
from ..services import storage
from ..services.audit import audit

router = APIRouter(prefix="/api", tags=["projects"])
ACTIVE = ("queued", "processing")
VIEWER_TTL_SEC = 600
MEDIA = {".splat": "application/octet-stream", ".ksplat": "application/octet-stream", ".spz": "application/octet-stream",
         ".ply": "application/octet-stream", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
         ".obj": "text/plain"}


def to_out(p: Project) -> ProjectOut:
    out = ProjectOut.model_validate(p)
    out.has_result = bool(p.result_path) and p.status == "completed"
    out.result_format = Path(p.result_path).suffix.lstrip(".") if p.result_path else None
    return out


@router.post("/projects", response_model=ProjectOut, status_code=201)
async def create_project(request: Request, name: str = Form(..., min_length=1, max_length=160),
                         file: UploadFile = File(...), user: User = Depends(current_user),
                         db: Session = Depends(get_db)):
    active = db.scalar(select(func.count()).select_from(Project)
                       .where(Project.owner_id == user.id, Project.status.in_(ACTIVE)))
    if active >= settings.max_active_jobs_per_user:
        raise AppError(429, "too_many_jobs", f"You already have {active} running job(s). Wait for one to finish.")
    pid = storage.new_id()
    rel, size = await storage.save_upload(file, pid)
    p = Project(id=pid, owner_id=user.id, name=name.strip(), original_filename=Path(file.filename or "video").name[:255],
                size_bytes=size, video_path=rel)
    db.add(p)
    db.commit()
    db.add(JobLog(project_id=pid, level="INFO", message=f"Video uploaded ({size} bytes), queued"))
    db.commit()
    audit(db, request, "project_created", user.id, pid)
    return to_out(p)


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(all: bool = False, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                  user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = select(Project).order_by(Project.created_at.desc()).limit(limit).offset(offset)
    if not (all and user.role == "admin"):
        q = q.where(Project.owner_id == user.id)
    return [to_out(p) for p in db.scalars(q)]


@router.get("/projects/{project_id}", response_model=ProjectOut)
def get_project(project_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return to_out(get_project_for(db, user, project_id))


@router.get("/projects/{project_id}/logs", response_model=list[LogOut])
def project_logs(project_id: str, after_id: int = 0, limit: int = Query(500, ge=1, le=2000),
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_project_for(db, user, project_id)
    return list(db.scalars(select(JobLog).where(JobLog.project_id == project_id, JobLog.id > after_id)
                           .order_by(JobLog.id).limit(limit)))


@router.post("/projects/{project_id}/cancel", response_model=ProjectOut)
def cancel(project_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = get_project_for(db, user, project_id)
    if p.status not in ACTIVE:
        raise AppError(409, "not_cancellable", f"Project is {p.status}, nothing to cancel")
    p.status, p.stage = "cancelled", "Cancelled"
    db.commit()
    audit(db, request, "project_cancelled", user.id, p.id)
    return to_out(p)


@router.post("/projects/{project_id}/retry", response_model=ProjectOut)
def retry(project_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = get_project_for(db, user, project_id)
    if p.status not in ("failed", "cancelled"):
        raise AppError(409, "not_retryable", "Only failed or cancelled projects can be retried")
    p.status, p.stage, p.progress, p.error = "queued", "Queued", 0, None
    db.commit()
    audit(db, request, "project_retried", user.id, p.id)
    return to_out(p)


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: str, request: Request, user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    p = get_project_for(db, user, project_id)
    if p.status == "processing":
        raise AppError(409, "project_busy", "Cancel the running job before deleting")
    db.query(JobLog).filter(JobLog.project_id == p.id).delete()
    db.delete(p)
    db.commit()
    storage.delete_project_files(project_id)
    audit(db, request, "project_deleted", user.id, project_id)


@router.get("/projects/{project_id}/viewer", response_model=ViewerOut)
def viewer(project_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Returns a short-lived URL the 3D viewer can load directly (three.js / splat loaders can't send headers)."""
    p = get_project_for(db, user, project_id)
    if p.status != "completed" or not p.result_path:
        raise AppError(409, "result_not_ready", f"3D result is not ready (status: {p.status})")
    token = create_token(str(user.id), "asset", timedelta(seconds=VIEWER_TTL_SEC), pid=p.id)
    base = str(request.base_url).rstrip("/")
    return ViewerOut(url=f"{base}/api/assets/{p.id}/result?token={token}",
                     format=Path(p.result_path).suffix.lstrip("."), expires_in=VIEWER_TTL_SEC)


@router.get("/assets/{project_id}/result")
def result_file(project_id: str, request: Request, token: str | None = None, db: Session = Depends(get_db)):
    auth = request.headers.get("authorization", "")
    if token:
        data = decode_token(token, "asset")
        if data.get("pid") != project_id:
            raise AppError(403, "forbidden", "Token is not valid for this project")
        user = db.get(User, int(data["sub"]))
        if not user or not user.is_active:
            raise AppError(401, "invalid_token", "Invalid token")
    elif auth.lower().startswith("bearer "):
        user = user_from_token(db, auth[7:])
    else:
        raise AppError(401, "not_authenticated", "Authentication required")
    p = get_project_for(db, user, project_id)
    if p.status != "completed" or not p.result_path:
        raise AppError(409, "result_not_ready", "3D result is not ready")
    path = storage.abs_path(p.result_path)
    if not path.is_file():
        raise AppError(410, "result_missing", "Result file is missing on the server")
    return FileResponse(path, media_type=MEDIA.get(path.suffix.lower(), "application/octet-stream"),
                        filename=f"{p.name}{path.suffix}".replace('"', ""),
                        headers={"Cache-Control": "private, max-age=300"})
