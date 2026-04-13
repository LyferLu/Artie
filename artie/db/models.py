import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.utcnow()


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    last_login: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    sessions: Mapped[list["WorkspaceSession"]] = relationship(
        "WorkspaceSession", back_populates="user", cascade="all, delete-orphan"
    )
    assets: Mapped[list["Asset"]] = relationship(
        "Asset", back_populates="user", cascade="all, delete-orphan"
    )
    operations: Mapped[list["OperationRun"]] = relationship(
        "OperationRun", back_populates="user", cascade="all, delete-orphan"
    )
    activity_events: Mapped[list["ActivityEvent"]] = relationship(
        "ActivityEvent", back_populates="user", cascade="all, delete-orphan"
    )


class WorkspaceSession(Base):
    __tablename__ = "workspace_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False, index=True)
    source_feature: Mapped[str] = mapped_column(String(64), nullable=False, default="inpaint")
    current_feature: Mapped[str] = mapped_column(String(64), nullable=False, default="inpaint")
    current_snapshot_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    current_asset_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    current_mask_asset_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    current_preview_asset_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    last_operation_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)

    user: Mapped["User"] = relationship("User", back_populates="sessions")
    snapshots: Mapped[list["SessionSnapshot"]] = relationship(
        "SessionSnapshot", back_populates="session", cascade="all, delete-orphan"
    )
    feature_states: Mapped[list["SessionFeatureState"]] = relationship(
        "SessionFeatureState", back_populates="session", cascade="all, delete-orphan"
    )
    assets: Mapped[list["Asset"]] = relationship(
        "Asset", back_populates="session", cascade="all, delete-orphan"
    )
    operations: Mapped[list["OperationRun"]] = relationship(
        "OperationRun", back_populates="session", cascade="all, delete-orphan"
    )
    activity_events: Mapped[list["ActivityEvent"]] = relationship(
        "ActivityEvent", back_populates="session", cascade="all, delete-orphan"
    )


class SessionSnapshot(Base):
    __tablename__ = "session_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspace_sessions.id"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    active_tab: Mapped[str] = mapped_column(String(64), nullable=False)
    primary_asset_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    mask_asset_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    preview_asset_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    asset_roles_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    workspace_state_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)

    session: Mapped["WorkspaceSession"] = relationship("WorkspaceSession", back_populates="snapshots")


class SessionFeatureState(Base):
    __tablename__ = "session_feature_states"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspace_sessions.id"), nullable=False, index=True
    )
    feature_key: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    state_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    session: Mapped["WorkspaceSession"] = relationship("WorkspaceSession", back_populates="feature_states")


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    session_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("workspace_sessions.id"), nullable=True, index=True
    )
    kind: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    origin_feature: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    metadata_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)

    user: Mapped["User"] = relationship("User", back_populates="assets")
    session: Mapped["WorkspaceSession"] = relationship("WorkspaceSession", back_populates="assets")
    files: Mapped[list["AssetFile"]] = relationship(
        "AssetFile", back_populates="asset", cascade="all, delete-orphan"
    )
    operation_links: Mapped[list["OperationRunAsset"]] = relationship(
        "OperationRunAsset", back_populates="asset", cascade="all, delete-orphan"
    )


class AssetFile(Base):
    __tablename__ = "asset_files"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    asset_id: Mapped[str] = mapped_column(String(36), ForeignKey("assets.id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(64), nullable=False, default="original")
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    file_ext: Mapped[str | None] = mapped_column(String(16), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    byte_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    asset: Mapped["Asset"] = relationship("Asset", back_populates="files")


class OperationRun(Base):
    __tablename__ = "operation_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    session_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("workspace_sessions.id"), nullable=True, index=True
    )
    feature: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    operation: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    model_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    plugin_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="success", index=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    request_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    response_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="operations")
    session: Mapped["WorkspaceSession"] = relationship("WorkspaceSession", back_populates="operations")
    asset_links: Mapped[list["OperationRunAsset"]] = relationship(
        "OperationRunAsset", back_populates="operation_run", cascade="all, delete-orphan"
    )


class OperationRunAsset(Base):
    __tablename__ = "operation_run_assets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    operation_run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("operation_runs.id"), nullable=False, index=True
    )
    asset_id: Mapped[str] = mapped_column(String(36), ForeignKey("assets.id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(64), nullable=False, default="input")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    operation_run: Mapped["OperationRun"] = relationship("OperationRun", back_populates="asset_links")
    asset: Mapped["Asset"] = relationship("Asset", back_populates="operation_links")


class ActivityEvent(Base):
    __tablename__ = "activity_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    session_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("workspace_sessions.id"), nullable=True, index=True
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    feature: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    detail_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)

    user: Mapped["User"] = relationship("User", back_populates="activity_events")
    session: Mapped["WorkspaceSession"] = relationship("WorkspaceSession", back_populates="activity_events")
