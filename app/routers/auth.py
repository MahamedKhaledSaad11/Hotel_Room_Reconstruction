import time
from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import current_user
from ..errors import AppError
from ..models import User
from ..schemas import LoginIn, PasswordChangeIn, RefreshIn, RegisterIn, TokenOut, UserOut
from ..security import create_token, decode_token, hash_password, verify_password
from ..services.audit import audit, client_ip

router = APIRouter(prefix="/api/auth", tags=["auth"])

# naive in-memory brute-force guard (use Redis if you run several processes)
_FAILS: dict[str, list[float]] = {}
MAX_FAILS, WINDOW = 5, 15 * 60


def _locked(key: str) -> bool:
    now = time.time()
    _FAILS[key] = [t for t in _FAILS.get(key, []) if now - t < WINDOW]
    return len(_FAILS[key]) >= MAX_FAILS


def _tokens(user: User) -> TokenOut:
    access = create_token(str(user.id), "access", timedelta(minutes=settings.access_ttl_min), tv=user.token_version)
    refresh = create_token(str(user.id), "refresh", timedelta(days=settings.refresh_ttl_days), tv=user.token_version)
    return TokenOut(access_token=access, refresh_token=refresh, expires_in=settings.access_ttl_min * 60,
                    user=UserOut.model_validate(user))


@router.post("/register", response_model=TokenOut, status_code=201)
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    if not settings.allow_registration:
        raise AppError(403, "registration_closed", "Registration is disabled")
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise AppError(409, "email_taken", "An account with this email already exists")
    user = User(email=email, name=body.name.strip(), password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    audit(db, request, "register", user.id)
    return _tokens(user)


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    email = body.email.lower()
    key = f"{email}|{client_ip(request)}"
    if _locked(key):
        raise AppError(429, "too_many_attempts", "Too many failed attempts, try again in 15 minutes")
    user = db.scalar(select(User).where(User.email == email))
    if not user or not verify_password(body.password, user.password_hash):
        _FAILS.setdefault(key, []).append(time.time())
        audit(db, request, "login_failed", user.id if user else None, email)
        raise AppError(401, "bad_credentials", "Incorrect email or password")
    if not user.is_active:
        raise AppError(403, "account_disabled", "This account is disabled")
    _FAILS.pop(key, None)
    audit(db, request, "login", user.id)
    return _tokens(user)


@router.post("/refresh", response_model=TokenOut)
def refresh(body: RefreshIn, db: Session = Depends(get_db)):
    data = decode_token(body.refresh_token, "refresh")
    user = db.get(User, int(data["sub"]))
    if not user or not user.is_active or user.token_version != data.get("tv"):
        raise AppError(401, "invalid_token", "Session is no longer valid, please log in again")
    return _tokens(user)


@router.post("/logout", status_code=204)
def logout(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    user.token_version += 1  # revokes every access/refresh token of this user
    db.commit()
    audit(db, request, "logout", user.id)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user


@router.post("/change-password", status_code=204)
def change_password(body: PasswordChangeIn, request: Request, user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    if not verify_password(body.old_password, user.password_hash):
        raise AppError(400, "bad_credentials", "Old password is incorrect")
    user.password_hash = hash_password(body.new_password)
    user.token_version += 1
    db.commit()
    audit(db, request, "password_changed", user.id)
