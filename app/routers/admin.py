from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import admin_user
from ..errors import AppError
from ..models import AuditLog, User
from ..schemas import AdminUserPatch, AuditOut, UserOut
from ..services.audit import audit

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/users", response_model=list[UserOut])
def users(limit: int = Query(100, ge=1, le=500), _: User = Depends(admin_user), db: Session = Depends(get_db)):
    return list(db.scalars(select(User).order_by(User.id).limit(limit)))


@router.patch("/users/{user_id}", response_model=UserOut)
def patch_user(user_id: int, body: AdminUserPatch, request: Request, admin: User = Depends(admin_user),
               db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise AppError(404, "user_not_found", "User not found")
    if u.id == admin.id and (body.is_active is False or body.role == "user"):
        raise AppError(400, "self_lockout", "You can't disable or demote yourself")
    if body.role is not None:
        u.role = body.role
    if body.is_active is not None:
        u.is_active = body.is_active
    u.token_version += 1  # force re-login so new permissions apply
    db.commit()
    audit(db, request, "admin_user_updated", admin.id, f"user={u.id} role={u.role} active={u.is_active}")
    return u


@router.get("/audit", response_model=list[AuditOut])
def audit_log(limit: int = Query(100, ge=1, le=1000), action: str | None = None, _: User = Depends(admin_user),
              db: Session = Depends(get_db)):
    q = select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)
    if action:
        q = q.where(AuditLog.action == action)
    return list(db.scalars(q))
