from datetime import datetime
from pathlib import Path
from typing import Optional, List

from sqlalchemy.orm import Session

from artie.db.models import User, Project, Image


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
# Project CRUD
# ---------------------------------------------------------------------------

def get_projects(db: Session, user_id: str) -> List[Project]:
    return (
        db.query(Project)
        .filter(Project.user_id == user_id)
        .order_by(Project.updated_at.desc())
        .all()
    )


def get_project(db: Session, project_id: str, user_id: str) -> Optional[Project]:
    return (
        db.query(Project)
        .filter(Project.id == project_id, Project.user_id == user_id)
        .first()
    )


def create_project(db: Session, user_id: str, name: str, description: str = "") -> Project:
    project = Project(user_id=user_id, name=name, description=description)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def delete_project(db: Session, project_id: str, user_id: str) -> bool:
    project = get_project(db, project_id, user_id)
    if not project:
        return False
    db.delete(project)
    db.commit()
    return True


def get_or_create_default_project(db: Session, user_id: str) -> Project:
    projects = get_projects(db, user_id)
    if projects:
        return projects[0]
    return create_project(db, user_id, "默认项目", "自动创建的默认项目")


# ---------------------------------------------------------------------------
# Image CRUD
# ---------------------------------------------------------------------------

def get_images(
    db: Session,
    user_id: str,
    project_id: Optional[str] = None,
    image_type: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
) -> List[Image]:
    q = db.query(Image).filter(Image.user_id == user_id)
    if project_id:
        q = q.filter(Image.project_id == project_id)
    if image_type:
        q = q.filter(Image.image_type == image_type)
    return q.order_by(Image.created_at.desc()).offset(skip).limit(limit).all()


def get_image(db: Session, image_id: str, user_id: str) -> Optional[Image]:
    return (
        db.query(Image)
        .filter(Image.id == image_id, Image.user_id == user_id)
        .first()
    )


def create_image(
    db: Session,
    user_id: str,
    filename: str,
    storage_path: str,
    image_type: str,
    project_id: Optional[str] = None,
    prompt: Optional[str] = None,
    negative_prompt: Optional[str] = None,
    seed: Optional[int] = None,
    model_name: Optional[str] = None,
    width: Optional[int] = None,
    height: Optional[int] = None,
) -> Image:
    image = Image(
        user_id=user_id,
        filename=filename,
        storage_path=storage_path,
        image_type=image_type,
        project_id=project_id,
        prompt=prompt,
        negative_prompt=negative_prompt,
        seed=seed,
        model_name=model_name,
        width=width,
        height=height,
    )
    db.add(image)
    db.commit()
    db.refresh(image)
    return image


def delete_image(db: Session, image_id: str, user_id: str) -> bool:
    image = get_image(db, image_id, user_id)
    if not image:
        return False
    storage_path = Path(image.storage_path)
    db.delete(image)
    db.commit()
    if storage_path.exists():
        storage_path.unlink(missing_ok=True)
    return True
