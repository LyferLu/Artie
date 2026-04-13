import json
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session, selectinload

from artie.db.models import (
    ActivityEvent,
    Asset,
    AssetFile,
    OperationRun,
    OperationRunAsset,
    SessionFeatureState,
    SessionSnapshot,
    User,
    WorkspaceSession,
)


def dumps_json(value: Any) -> str:
    return json.dumps(value or {}, ensure_ascii=False)


def loads_json(value: Optional[str], default: Any):
    if not value:
        return default
    try:
        return json.loads(value)
    except Exception:
        return default


# ---------------------------------------------------------------------------
# User CRUD
# ---------------------------------------------------------------------------


def get_user_by_username(db: Session, username: str) -> Optional[User]:
    return db.query(User).filter(User.username == username).first()


def get_user_by_email(db: Session, email: str) -> Optional[User]:
    return db.query(User).filter(User.email == email).first()


def get_user_by_id(db: Session, user_id: str) -> Optional[User]:
    return db.query(User).filter(User.id == user_id).first()


def create_user(db: Session, username: str, email: str, hashed_password: str) -> User:
    user = User(username=username, email=email, hashed_password=hashed_password)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def update_user_last_login(db: Session, user: User):
    user.last_login = datetime.utcnow()
    db.commit()


# ---------------------------------------------------------------------------
# Workspace sessions
# ---------------------------------------------------------------------------


def list_workspace_sessions(
    db: Session,
    user_id: str,
    *,
    search: Optional[str] = None,
    feature: Optional[str] = None,
    include_deleted: bool = False,
    limit: int = 100,
) -> list[WorkspaceSession]:
    q = (
        db.query(WorkspaceSession)
        .options(
            selectinload(WorkspaceSession.snapshots),
            selectinload(WorkspaceSession.feature_states),
            selectinload(WorkspaceSession.operations),
        )
        .filter(WorkspaceSession.user_id == user_id)
    )
    if not include_deleted:
        q = q.filter(WorkspaceSession.deleted_at.is_(None))
    if feature:
        q = q.filter(WorkspaceSession.current_feature == feature)
    if search:
        q = q.filter(WorkspaceSession.title.ilike(f"%{search}%"))
    return q.order_by(WorkspaceSession.updated_at.desc()).limit(limit).all()


def get_workspace_session(
    db: Session, session_id: str, user_id: str, *, include_deleted: bool = False
) -> Optional[WorkspaceSession]:
    q = (
        db.query(WorkspaceSession)
        .options(
            selectinload(WorkspaceSession.snapshots),
            selectinload(WorkspaceSession.feature_states),
            selectinload(WorkspaceSession.operations),
            selectinload(WorkspaceSession.activity_events),
        )
        .filter(WorkspaceSession.id == session_id, WorkspaceSession.user_id == user_id)
    )
    if not include_deleted:
        q = q.filter(WorkspaceSession.deleted_at.is_(None))
    return q.first()


def create_workspace_session(
    db: Session,
    *,
    user_id: str,
    title: str,
    source_feature: str,
    current_feature: str,
    description: Optional[str] = None,
) -> WorkspaceSession:
    session = WorkspaceSession(
        user_id=user_id,
        title=title,
        description=description,
        source_feature=source_feature,
        current_feature=current_feature,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def soft_delete_workspace_session(db: Session, session: WorkspaceSession):
    session.deleted_at = datetime.utcnow()
    session.status = "deleted"
    db.commit()


def touch_workspace_session(
    db: Session,
    session: WorkspaceSession,
    *,
    title: Optional[str] = None,
    current_feature: Optional[str] = None,
    current_snapshot_id: Optional[str] = None,
    current_asset_id: Optional[str] = None,
    current_mask_asset_id: Optional[str] = None,
    current_preview_asset_id: Optional[str] = None,
    last_operation_id: Optional[str] = None,
):
    if title:
        session.title = title
    if current_feature:
        session.current_feature = current_feature
    if current_snapshot_id is not None:
        session.current_snapshot_id = current_snapshot_id
    if current_asset_id is not None:
        session.current_asset_id = current_asset_id
    if current_mask_asset_id is not None:
        session.current_mask_asset_id = current_mask_asset_id
    if current_preview_asset_id is not None:
        session.current_preview_asset_id = current_preview_asset_id
    if last_operation_id is not None:
        session.last_operation_id = last_operation_id
    session.updated_at = datetime.utcnow()
    db.commit()


# ---------------------------------------------------------------------------
# Feature state
# ---------------------------------------------------------------------------


def upsert_feature_states(
    db: Session, session_id: str, settings_by_feature: dict[str, Any]
) -> list[SessionFeatureState]:
    states: list[SessionFeatureState] = []
    for feature_key, state_value in (settings_by_feature or {}).items():
        row = (
            db.query(SessionFeatureState)
            .filter(
                SessionFeatureState.session_id == session_id,
                SessionFeatureState.feature_key == feature_key,
            )
            .first()
        )
        if row is None:
            row = SessionFeatureState(
                session_id=session_id,
                feature_key=feature_key,
                state_json=dumps_json(state_value),
            )
            db.add(row)
        else:
            row.state_json = dumps_json(state_value)
            row.updated_at = datetime.utcnow()
        states.append(row)
    db.commit()
    for row in states:
        db.refresh(row)
    return states


def get_feature_states_map(session: WorkspaceSession) -> dict[str, Any]:
    return {
        item.feature_key: loads_json(item.state_json, {})
        for item in sorted(session.feature_states, key=lambda x: x.feature_key)
    }


# ---------------------------------------------------------------------------
# Assets
# ---------------------------------------------------------------------------


def create_asset_with_file(
    db: Session,
    *,
    user_id: str,
    session_id: Optional[str],
    kind: str,
    origin_feature: Optional[str],
    label: Optional[str],
    mime_type: Optional[str],
    width: Optional[int],
    height: Optional[int],
    metadata: Optional[dict[str, Any]],
    role: str,
    filename: str,
    storage_path: str,
    file_ext: Optional[str],
    byte_size: Optional[int],
    sha256: Optional[str],
) -> Asset:
    asset = Asset(
        user_id=user_id,
        session_id=session_id,
        kind=kind,
        origin_feature=origin_feature,
        label=label,
        mime_type=mime_type,
        width=width,
        height=height,
        metadata_json=dumps_json(metadata),
    )
    db.add(asset)
    db.flush()

    db.add(
        AssetFile(
            asset_id=asset.id,
            role=role,
            filename=filename,
            storage_path=storage_path,
            file_ext=file_ext,
            mime_type=mime_type,
            byte_size=byte_size,
            sha256=sha256,
            width=width,
            height=height,
        )
    )
    db.commit()
    db.refresh(asset)
    return asset


def get_asset(db: Session, asset_id: str, user_id: str) -> Optional[Asset]:
    return (
        db.query(Asset)
        .options(selectinload(Asset.files))
        .filter(Asset.id == asset_id, Asset.user_id == user_id)
        .first()
    )


def get_asset_primary_file(asset: Asset) -> Optional[AssetFile]:
    if not asset.files:
        return None
    return sorted(asset.files, key=lambda item: item.created_at)[0]


# ---------------------------------------------------------------------------
# Snapshots
# ---------------------------------------------------------------------------


def create_snapshot(
    db: Session,
    *,
    session_id: str,
    user_id: str,
    title: Optional[str],
    active_tab: str,
    primary_asset_id: Optional[str],
    mask_asset_id: Optional[str],
    preview_asset_id: Optional[str],
    asset_roles: dict[str, Any],
    workspace_state: dict[str, Any],
) -> SessionSnapshot:
    snapshot = SessionSnapshot(
        session_id=session_id,
        user_id=user_id,
        title=title,
        active_tab=active_tab,
        primary_asset_id=primary_asset_id,
        mask_asset_id=mask_asset_id,
        preview_asset_id=preview_asset_id,
        asset_roles_json=dumps_json(asset_roles),
        workspace_state_json=dumps_json(workspace_state),
    )
    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)
    return snapshot


def list_operation_runs(db: Session, session_id: str, user_id: str, limit: int = 100) -> list[OperationRun]:
    return (
        db.query(OperationRun)
        .options(selectinload(OperationRun.asset_links))
        .filter(OperationRun.session_id == session_id, OperationRun.user_id == user_id)
        .order_by(OperationRun.started_at.desc())
        .limit(limit)
        .all()
    )


# ---------------------------------------------------------------------------
# Operations / activity
# ---------------------------------------------------------------------------


def create_operation_run(
    db: Session,
    *,
    user_id: str,
    session_id: Optional[str],
    feature: str,
    operation: str,
    model_name: Optional[str],
    plugin_name: Optional[str],
    status: str,
    duration_ms: Optional[int],
    request_data: Optional[dict[str, Any]],
    response_data: Optional[dict[str, Any]],
    error_message: Optional[str],
) -> OperationRun:
    now = datetime.utcnow()
    row = OperationRun(
        user_id=user_id,
        session_id=session_id,
        feature=feature,
        operation=operation,
        model_name=model_name,
        plugin_name=plugin_name,
        status=status,
        duration_ms=duration_ms,
        request_json=dumps_json(request_data),
        response_json=dumps_json(response_data),
        error_message=error_message,
        started_at=now,
        finished_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def link_operation_asset(db: Session, operation_run_id: str, asset_id: str, role: str):
    db.add(OperationRunAsset(operation_run_id=operation_run_id, asset_id=asset_id, role=role))
    db.commit()


def create_activity_event(
    db: Session,
    *,
    user_id: str,
    session_id: Optional[str],
    event_type: str,
    feature: Optional[str],
    detail: Optional[dict[str, Any]],
) -> ActivityEvent:
    row = ActivityEvent(
        user_id=user_id,
        session_id=session_id,
        event_type=event_type,
        feature=feature,
        detail_json=dumps_json(detail),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
