from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

ARTIE_HOME = Path.home() / ".artie"
ARTIE_HOME.mkdir(parents=True, exist_ok=True)

DEFAULT_DB_PATH = ARTIE_HOME / "artie.db"

_engine = None
_SessionLocal = None


def init_db(db_path: Path = DEFAULT_DB_PATH):
    global _engine, _SessionLocal
    if db_path is None:
        db_path = DEFAULT_DB_PATH
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    _engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)
    from artie.db.models import Base
    Base.metadata.create_all(bind=_engine)


def get_db():
    if _SessionLocal is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()
