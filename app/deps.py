from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .db import get_db
from .errors import AppError
from .models import Project, User
from .security import decode_token

bearer = HTTPBearer(auto_error=False)


def user_from_token(db: Session, token: str) -> User:
    data = decode_token(token, "access")
    user = db.get(User, int(data["sub"]))
    if not user or not user.is_active or user.token_version != data.get("tv"):
        raise AppError(401, "invalid_token", "Session is no longer valid, please log in again")
    return user


def current_user(request: Request, creds: HTTPAuthorizationCredentials | None = Depends(bearer),
                 db: Session = Depends(get_db)) -> User:
    if creds is None:
        raise AppError(401, "not_authenticated", "Authentication required")
    user = user_from_token(db, creds.credentials)
    request.state.user_id = user.id
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise AppError(403, "forbidden", "Admin access required")
    return user


def get_project_for(db: Session, user: User, project_id: str) -> Project:
    """Owner or admin only. Others get 404 so project ids can't be probed."""
    p = db.get(Project, project_id)
    if not p or (p.owner_id != user.id and user.role != "admin"):
        raise AppError(404, "project_not_found", "Project not found")
    return p
