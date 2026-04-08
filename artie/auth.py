"""JWT-based authentication for Artie.

Usage:
- Call `init_auth(secret_key, disable_auth)` once at startup.
- Use `get_current_user` as a FastAPI dependency for protected routes.
- When `disable_auth=True`, `get_current_user` returns a built-in anonymous user.
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from loguru import logger
from sqlalchemy.orm import Session

from artie.db.database import get_db
from artie.db.models import User

_SECRET_KEY: str = "CHANGE_ME_IN_PRODUCTION"
_ALGORITHM = "HS256"
_ACCESS_TOKEN_EXPIRE_MINUTES = 60

_DISABLE_AUTH: bool = False
_ANON_USER: Optional[User] = None

bearer_scheme = HTTPBearer(auto_error=False)


def init_auth(secret_key: str, disable_auth: bool = False):
    global _SECRET_KEY, _DISABLE_AUTH
    _SECRET_KEY = secret_key
    _DISABLE_AUTH = disable_auth
    if disable_auth:
        logger.info("Authentication disabled — all requests run as anonymous user")


def hash_password(password: str) -> str:
    import bcrypt
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    import bcrypt
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str, expires_delta: Optional[timedelta] = None) -> str:
    from jose import jwt
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=_ACCESS_TOKEN_EXPIRE_MINUTES))
    payload = {"sub": user_id, "exp": expire}
    return jwt.encode(payload, _SECRET_KEY, algorithm=_ALGORITHM)


def decode_access_token(token: str) -> Optional[str]:
    """Return user_id from token, or None on failure."""
    try:
        from jose import jwt, JWTError
        payload = jwt.decode(token, _SECRET_KEY, algorithms=[_ALGORITHM])
        return payload.get("sub")
    except Exception:
        return None


def _get_or_create_anon_user(db: Session) -> User:
    """Return (and lazily create) the built-in anonymous user."""
    anon = db.query(User).filter(User.username == "__anonymous__").first()
    if anon is None:
        anon = User(
            username="__anonymous__",
            email="anonymous@localhost",
            hashed_password="",
        )
        db.add(anon)
        db.commit()
        db.refresh(anon)
    return anon


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if _DISABLE_AUTH:
        return _get_or_create_anon_user(db)

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    from artie.db.crud import get_user_by_id
    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    return user


def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """Like get_current_user but returns None instead of raising when unauthenticated."""
    if _DISABLE_AUTH:
        return _get_or_create_anon_user(db)
    if credentials is None:
        return None
    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        return None
    from artie.db.crud import get_user_by_id
    return get_user_by_id(db, user_id)
