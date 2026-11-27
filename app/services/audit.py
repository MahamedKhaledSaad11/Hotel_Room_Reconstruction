from fastapi import Request
from sqlalchemy.orm import Session

from ..models import AuditLog


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else ""))[:64]


def audit(db: Session, request: Request, action: str, user_id: int | None = None, detail: str = "") -> None:
    db.add(AuditLog(user_id=user_id, action=action, detail=detail[:1000], ip=client_ip(request)))
    db.commit()
