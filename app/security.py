from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from .config import settings
from .errors import AppError

ALGO = "HS256"


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except ValueError:
        return False


def create_token(sub: str, typ: str, ttl: timedelta, **extra) -> str:
    payload = {"sub": sub, "typ": typ, "iat": datetime.now(timezone.utc),
               "exp": datetime.now(timezone.utc) + ttl, **extra}
    return jwt.encode(payload, settings.secret_key, algorithm=ALGO)


def decode_token(token: str, expected_typ: str) -> dict:
    try:
        data = jwt.decode(token, settings.secret_key, algorithms=[ALGO])
    except jwt.ExpiredSignatureError:
        raise AppError(401, "token_expired", "Session expired, please log in again")
    except jwt.PyJWTError:
        raise AppError(401, "invalid_token", "Invalid authentication token")
    if data.get("typ") != expected_typ:
        raise AppError(401, "invalid_token", "Wrong token type")
    return data
