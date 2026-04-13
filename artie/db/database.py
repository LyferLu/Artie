import shutil
from datetime import datetime
from pathlib import Path

from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker, DeclarativeBase

ARTIE_HOME = Path.home() / ".artie"
ARTIE_HOME.mkdir(parents=True, exist_ok=True)

DEFAULT_DB_PATH = ARTIE_HOME / "artie.db"

NEW_SCHEMA_TABLES = {
    "users",
    "workspace_sessions",
    "session_snapshots",
    "session_feature_states",
    "assets",
    "asset_files",
    "operation_runs",
    "operation_run_assets",
    "activity_events",
}
LEGACY_SCHEMA_TABLES = {"projects", "images"}

_engine = None
_SessionLocal = None


def init_db(db_path: Path = DEFAULT_DB_PATH):
    global _engine, _SessionLocal
    if db_path is None:
        db_path = DEFAULT_DB_PATH
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    if db_path.exists():
        probe_engine = create_engine(
            f"sqlite:///{db_path}",
            connect_args={"check_same_thread": False},
        )
        try:
            existing_tables = set(inspect(probe_engine).get_table_names())
        finally:
            probe_engine.dispose()

        if LEGACY_SCHEMA_TABLES & existing_tables and not NEW_SCHEMA_TABLES.issubset(existing_tables):
            backup_name = (
                f"{db_path.stem}.backup_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}{db_path.suffix}"
            )
            backup_path = db_path.with_name(backup_name)
            shutil.move(str(db_path), str(backup_path))

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
