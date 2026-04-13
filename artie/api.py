import asyncio
import base64
import hashlib
import mimetypes
import os
import threading
import time
import traceback
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
import numpy as np
import socketio
import torch

try:
    torch._C._jit_override_can_fuse_on_cpu(False)
    torch._C._jit_override_can_fuse_on_gpu(False)
    torch._C._jit_set_texpr_fuser_enabled(False)
    torch._C._jit_set_nvfuser_enabled(False)
    torch._C._jit_set_profiling_mode(False)
except Exception:
    pass

import uvicorn
from PIL import Image
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from loguru import logger
from sqlalchemy.orm import Session

from artie.auth import (
    create_access_token,
    decode_access_token,
    get_current_user,
    get_optional_user,
    hash_password,
    init_auth,
    verify_password,
)
from artie.db import crud as db_crud
from artie.db.database import ARTIE_HOME, get_db, init_db
from artie.db.models import Asset, OperationRun, SessionSnapshot, User, WorkspaceSession
from artie.file_manager import FileManager
from artie.helper import (
    adjust_mask,
    concat_alpha_channel,
    decode_base64_to_image,
    gen_frontend_mask,
    load_img,
    numpy_to_bytes,
    pil_to_bytes,
)
from artie.model.utils import torch_gc
from artie.model_manager import ModelManager
from artie.plugins import InteractiveSeg, RealESRGANUpscaler, build_plugins
from artie.plugins.base_plugin import BasePlugin
from artie.plugins.remove_bg import RemoveBG
from artie.schema import (
    AdjustMaskRequest,
    ApiConfig,
    GenInfoResponse,
    InpaintRequest,
    InteractiveSegModel,
    ModelInfo,
    ModelType,
    PluginInfo,
    RealESRGANModel,
    RemoveBGModel,
    RunPluginRequest,
    SDSampler,
    SaveWorkspaceRequest,
    ServerConfigResponse,
    SwitchModelRequest,
    SwitchPluginModelRequest,
    SwitchTabRequest,
    TokenResponse,
    Txt2ImgRequest,
    UserCreate,
    UserLogin,
    UserResponse,
    VramStatusResponse,
    WorkspaceAssetInfo,
    WorkspaceDetailResponse,
    WorkspaceImportResponse,
    WorkspaceOperationResponse,
    WorkspaceResumeResponse,
    WorkspaceSnapshotResponse,
    WorkspaceSummaryResponse,
)

CURRENT_DIR = Path(__file__).parent.absolute().resolve()
WEB_APP_DIR = CURRENT_DIR / "web_app"


def api_middleware(app: FastAPI):
    rich_available = False
    try:
        if os.environ.get("WEBUI_RICH_EXCEPTIONS", None) is not None:
            import anyio  # noqa: F401
            import starlette  # noqa: F401
            from rich.console import Console

            console = Console()
            rich_available = True
    except Exception:
        pass

    def handle_exception(request: Request, e: Exception):
        err = {
            "error": type(e).__name__,
            "detail": vars(e).get("detail", ""),
            "body": vars(e).get("body", ""),
            "errors": str(e),
        }
        if not isinstance(e, HTTPException):
            message = f"API error: {request.method}: {request.url} {err}"
            if rich_available:
                print(message)
                console.print_exception(show_locals=True, max_frames=2, extra_lines=1, word_wrap=False)
            else:
                traceback.print_exc()
        return JSONResponse(
            status_code=vars(e).get("status_code", 500),
            content=jsonable_encoder(err),
        )

    @app.middleware("http")
    async def exception_handling(request: Request, call_next):
        try:
            return await call_next(request)
        except Exception as e:
            return handle_exception(request, e)

    @app.exception_handler(Exception)
    async def fastapi_exception_handler(request: Request, e: Exception):
        return handle_exception(request, e)

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, e: HTTPException):
        return handle_exception(request, e)

    app.add_middleware(
        CORSMiddleware,
        allow_methods=["*"],
        allow_headers=["*"],
        allow_origins=["*"],
        allow_credentials=True,
        expose_headers=["X-Seed"],
    )


global_sio: socketio.AsyncServer = None
global_api: "Api" = None


class TaskCancelledError(RuntimeError):
    pass


def diffuser_callback(pipe, step: int, timestep: int, callback_kwargs: Dict = {}):
    if global_api is not None and global_api.cancel_event.is_set():
        raise TaskCancelledError("Task canceled by user")
    asyncio.run(global_sio.emit("diffusion_progress", {"step": step}))
    if global_api is not None and global_api.cancel_event.is_set():
        raise TaskCancelledError("Task canceled by user")
    return {}


class Api:
    def __init__(self, app: FastAPI, config: ApiConfig):
        self.app = app
        self.config = config
        self.router = APIRouter()
        self.queue_lock = threading.Lock()
        self.task_state_lock = threading.Lock()
        self.cancel_event = threading.Event()
        self.current_task: Optional[str] = None
        api_middleware(self.app)

        init_db(config.db_path)
        init_auth(config.auth_secret_key, config.disable_auth)

        self.file_manager = self._build_file_manager()
        self.plugins = self._build_plugins()
        self.model_manager = self._build_model_manager()

        self.add_api_route("/api/v1/gen-info", self.api_geninfo, methods=["POST"], response_model=GenInfoResponse)
        self.add_api_route("/api/v1/server-config", self.api_server_config, methods=["GET"], response_model=ServerConfigResponse)
        self.add_api_route("/api/v1/model", self.api_current_model, methods=["GET"], response_model=ModelInfo)
        self.add_api_route("/api/v1/model", self.api_switch_model, methods=["POST"], response_model=ModelInfo)
        self.add_api_route("/api/v1/switch-tab", self.api_switch_tab, methods=["POST"], response_model=ModelInfo)
        self.add_api_route("/api/v1/inputimage", self.api_input_image, methods=["GET"])
        self.add_api_route("/api/v1/inpaint", self.api_inpaint, methods=["POST"])
        self.add_api_route("/api/v1/txt2img", self.api_txt2img, methods=["POST"])
        self.add_api_route("/api/v1/cancel-current-task", self.api_cancel_current_task, methods=["POST"])
        self.add_api_route("/api/v1/vram-status", self.api_vram_status, methods=["GET"], response_model=VramStatusResponse)
        self.add_api_route("/api/v1/switch_plugin_model", self.api_switch_plugin_model, methods=["POST"])
        self.add_api_route("/api/v1/run_plugin_gen_mask", self.api_run_plugin_gen_mask, methods=["POST"])
        self.add_api_route("/api/v1/run_plugin_gen_image", self.api_run_plugin_gen_image, methods=["POST"])
        self.add_api_route("/api/v1/samplers", self.api_samplers, methods=["GET"])
        self.add_api_route("/api/v1/adjust_mask", self.api_adjust_mask, methods=["POST"])
        self.add_api_route("/api/v1/save_image", self.api_save_image, methods=["POST"])
        self.add_api_route("/api/v1/auth/register", self.api_register, methods=["POST"], response_model=UserResponse)
        self.add_api_route("/api/v1/auth/login", self.api_login, methods=["POST"], response_model=TokenResponse)
        self.add_api_route("/api/v1/auth/me", self.api_me, methods=["GET"], response_model=UserResponse)
        self.add_api_route("/api/v1/workspaces", self.api_list_workspaces, methods=["GET"])
        self.add_api_route("/api/v1/workspaces/save", self.api_save_workspace, methods=["POST"], response_model=WorkspaceDetailResponse)
        self.add_api_route("/api/v1/workspaces/import", self.api_import_workspace, methods=["POST"], response_model=WorkspaceImportResponse)
        self.add_api_route("/api/v1/workspaces/{session_id}", self.api_get_workspace, methods=["GET"], response_model=WorkspaceDetailResponse)
        self.add_api_route("/api/v1/workspaces/{session_id}", self.api_delete_workspace, methods=["DELETE"])
        self.add_api_route("/api/v1/workspaces/{session_id}/resume", self.api_resume_workspace, methods=["POST"], response_model=WorkspaceResumeResponse)
        self.add_api_route("/api/v1/workspaces/{session_id}/operations", self.api_list_workspace_operations, methods=["GET"])
        self.add_api_route("/api/v1/assets/{asset_id}/file", self.api_get_asset_file, methods=["GET"])

        self.app.mount("/", StaticFiles(directory=WEB_APP_DIR, html=True), name="assets")

        global global_sio, global_api
        self.sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
        self.combined_asgi_app = socketio.ASGIApp(self.sio, self.app)
        self.app.mount("/ws", self.combined_asgi_app)
        global_sio = self.sio
        global_api = self

    def add_api_route(self, path: str, endpoint, **kwargs):
        return self.app.add_api_route(path, endpoint, **kwargs)

    def _start_cancelable_task(self, task_name: str):
        with self.task_state_lock:
            self.current_task = task_name
            self.cancel_event.clear()

    def _finish_cancelable_task(self):
        with self.task_state_lock:
            self.current_task = None
            self.cancel_event.clear()

    def _log_exec(
        self,
        op: str,
        before_model: str,
        target_model: str,
        switched: bool,
        seed: int,
        task_type: Optional[str] = None,
        requested_model: Optional[str] = None,
    ):
        logger.info(
            "execute op={} task_type={} requested_model={} before_model={} target_model={} switched={} seed={}",
            op,
            task_type or "-",
            requested_model or "-",
            before_model,
            target_model,
            switched,
            seed,
        )

    def _safe_json(self, payload: Any) -> dict[str, Any]:
        if payload is None:
            return {}
        if hasattr(payload, "model_dump"):
            payload = payload.model_dump()
        if not isinstance(payload, dict):
            return {"value": str(payload)}
        result = {}
        for key, value in payload.items():
            if key in {"image", "mask", "paint_by_example_example_image"}:
                result[key] = "<omitted>"
            elif isinstance(value, str):
                result[key] = value if len(value) <= 500 else f"{value[:500]}..."
            else:
                result[key] = value
        return result

    def _guess_ext(self, filename: Optional[str], mime_type: Optional[str], default_ext: str = "png") -> str:
        if filename and "." in filename:
            return filename.rsplit(".", 1)[1].lower()
        if mime_type:
            guessed = mimetypes.guess_extension(mime_type)
            if guessed:
                return guessed.lstrip(".")
        return default_ext

    def _decode_data_url(self, data_url: str) -> tuple[bytes, str]:
        if "," not in data_url:
            raise HTTPException(status_code=422, detail="Invalid asset payload")
        header, encoded = data_url.split(",", 1)
        mime_type = "image/png"
        if ";base64" in header and ":" in header:
            mime_type = header.split(":", 1)[1].split(";", 1)[0]
        return base64.b64decode(encoded), mime_type

    def _user_asset_dir(self, user_id: str, session_id: Optional[str], kind: str) -> Path:
        base = ARTIE_HOME / "users" / user_id / "workspace_assets"
        if session_id:
            base = base / session_id
        return base / kind

    def _write_asset_file(self, *, user_id: str, session_id: Optional[str], kind: str, filename: str, content: bytes) -> Path:
        asset_dir = self._user_asset_dir(user_id, session_id, kind)
        asset_dir.mkdir(parents=True, exist_ok=True)
        ext = self._guess_ext(filename, None)
        safe_name = f"{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.{ext}"
        storage_path = asset_dir / safe_name
        storage_path.write_bytes(content)
        return storage_path

    def _workspace_title(self, active_tab: str, title: Optional[str]) -> str:
        if title and title.strip():
            return title.strip()
        labels = {
            "generate": "文生图",
            "inpaint": "修复",
            "outpaint": "外扩",
            "ai_repaint": "AI重绘",
            "remove_bg": "去背景",
            "super_res": "超分辨率",
            "face_restore": "修复人脸",
        }
        return f"{labels.get(active_tab, active_tab)} {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}"

    def _require_workspace_session(self, db: Session, user: User, session_id: Optional[str]) -> Optional[WorkspaceSession]:
        if not session_id:
            return None
        session = db_crud.get_workspace_session(db, session_id, user.id)
        if session is None:
            raise HTTPException(status_code=404, detail="Workspace session not found")
        return session

    def _resolve_asset_request_user(self, request: Request, db: Session) -> User:
        if self.config.disable_auth:
            user = db_crud.get_user_by_username(db, "__anonymous__")
            if user is None:
                raise HTTPException(status_code=401, detail="Anonymous user unavailable")
            return user
        token = request.query_params.get("token")
        auth_header = request.headers.get("Authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ", 1)[1]
        if not token:
            raise HTTPException(status_code=401, detail="Not authenticated")
        user_id = decode_access_token(token)
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        user = db_crud.get_user_by_id(db, user_id)
        if user is None:
            raise HTTPException(status_code=401, detail="User not found")
        return user

    def _create_asset_from_upload(
        self,
        *,
        db: Session,
        user: User,
        session_id: Optional[str],
        active_tab: str,
        role: str,
        kind: str,
        data_url: str,
        filename: Optional[str],
        label: Optional[str],
        width: Optional[int],
        height: Optional[int],
        mime_type: Optional[str],
        metadata: Optional[dict[str, Any]],
    ) -> Asset:
        content, detected_mime = self._decode_data_url(data_url)
        mime_type = mime_type or detected_mime
        filename = filename or f"{kind}.{self._guess_ext(None, mime_type)}"
        storage_path = self._write_asset_file(
            user_id=user.id,
            session_id=session_id,
            kind=kind,
            filename=filename,
            content=content,
        )
        return db_crud.create_asset_with_file(
            db=db,
            user_id=user.id,
            session_id=session_id,
            kind=kind,
            origin_feature=active_tab,
            label=label,
            mime_type=mime_type,
            width=width,
            height=height,
            metadata=metadata or {},
            role=role,
            filename=Path(filename).name,
            storage_path=str(storage_path),
            file_ext=self._guess_ext(filename, mime_type),
            byte_size=len(content),
            sha256=hashlib.sha256(content).hexdigest(),
        )

    def _snapshot_to_response(self, snapshot: Optional[SessionSnapshot]) -> Optional[WorkspaceSnapshotResponse]:
        if snapshot is None:
            return None
        return WorkspaceSnapshotResponse(
            id=snapshot.id,
            title=snapshot.title,
            active_tab=snapshot.active_tab,
            primary_asset_id=snapshot.primary_asset_id,
            mask_asset_id=snapshot.mask_asset_id,
            preview_asset_id=snapshot.preview_asset_id,
            asset_roles=db_crud.loads_json(snapshot.asset_roles_json, {}),
            workspace_state=db_crud.loads_json(snapshot.workspace_state_json, {}),
            created_at=snapshot.created_at,
        )

    def _operation_to_response(self, op: Optional[OperationRun]) -> Optional[WorkspaceOperationResponse]:
        if op is None:
            return None
        return WorkspaceOperationResponse(
            id=op.id,
            feature=op.feature,
            operation=op.operation,
            model_name=op.model_name,
            plugin_name=op.plugin_name,
            status=op.status,
            duration_ms=op.duration_ms,
            request_data=db_crud.loads_json(op.request_json, {}),
            response_data=db_crud.loads_json(op.response_json, {}),
            error_message=op.error_message,
            started_at=op.started_at,
            finished_at=op.finished_at,
        )

    def _session_to_summary(self, session: WorkspaceSession) -> WorkspaceSummaryResponse:
        op_map = {item.id: item for item in session.operations}
        last_op = op_map.get(session.last_operation_id) if session.last_operation_id else None
        return WorkspaceSummaryResponse(
            id=session.id,
            title=session.title,
            status=session.status,
            source_feature=session.source_feature,
            current_feature=session.current_feature,
            current_snapshot_id=session.current_snapshot_id,
            primary_asset_id=session.current_asset_id,
            preview_asset_id=session.current_preview_asset_id,
            last_operation_id=session.last_operation_id,
            last_operation=self._operation_to_response(last_op),
            created_at=session.created_at,
            updated_at=session.updated_at,
        )

    def _asset_to_response(self, asset: Asset) -> WorkspaceAssetInfo:
        return WorkspaceAssetInfo(
            id=asset.id,
            kind=asset.kind,
            origin_feature=asset.origin_feature,
            label=asset.label,
            mime_type=asset.mime_type,
            width=asset.width,
            height=asset.height,
            metadata=db_crud.loads_json(asset.metadata_json, {}),
            created_at=asset.created_at,
        )

    def _create_operation_log(
        self,
        *,
        db: Session,
        user: Optional[User],
        session_id: Optional[str],
        feature: str,
        operation: str,
        model_name: Optional[str],
        plugin_name: Optional[str],
        duration_ms: Optional[int],
        request_data: Optional[dict[str, Any]],
        response_data: Optional[dict[str, Any]],
        error_message: Optional[str] = None,
    ) -> Optional[OperationRun]:
        if user is None:
            return None
        return db_crud.create_operation_run(
            db=db,
            user_id=user.id,
            session_id=session_id,
            feature=feature,
            operation=operation,
            model_name=model_name,
            plugin_name=plugin_name,
            status="failed" if error_message else "success",
            duration_ms=duration_ms,
            request_data=request_data,
            response_data=response_data,
            error_message=error_message,
        )

    def _create_activity(
        self,
        *,
        db: Session,
        user: Optional[User],
        session_id: Optional[str],
        event_type: str,
        feature: Optional[str],
        detail: Optional[dict[str, Any]],
    ):
        if user is None:
            return
        db_crud.create_activity_event(
            db=db,
            user_id=user.id,
            session_id=session_id,
            event_type=event_type,
            feature=feature,
            detail=detail,
        )

    def api_save_image(self, file: UploadFile):
        if not self.config.output_dir or not self.config.output_dir.exists():
            raise HTTPException(status_code=400, detail="Output directory not configured or doesn't exist")
        output_path = self.config.output_dir / Path(file.filename).name
        output_path.write_bytes(file.file.read())

    def api_current_model(self) -> ModelInfo:
        return self.model_manager.current_model

    def api_switch_model(self, req: SwitchModelRequest) -> ModelInfo:
        with self.queue_lock:
            if req.name == self.model_manager.name:
                return self.model_manager.current_model
            self.model_manager.switch(req.name)
            return self.model_manager.current_model

    def api_switch_tab(self, req: SwitchTabRequest) -> ModelInfo:
        _ = req
        return self.model_manager.current_model

    def api_cancel_current_task(self):
        with self.task_state_lock:
            if self.current_task is None:
                return {"cancel_requested": False, "task": None}
            self.cancel_event.set()
            task = self.current_task
        logger.info(f"Cancel requested for current task: {task}")
        return {"cancel_requested": True, "task": task}

    def api_switch_plugin_model(self, req: SwitchPluginModelRequest):
        if req.plugin_name in self.plugins:
            self.plugins[req.plugin_name].switch_model(req.model_name)
            if req.plugin_name == RemoveBG.name:
                self.config.remove_bg_model = req.model_name
            if req.plugin_name == RealESRGANUpscaler.name:
                self.config.realesrgan_model = req.model_name
            if req.plugin_name == InteractiveSeg.name:
                self.config.interactive_seg_model = req.model_name
            torch_gc()

    def api_server_config(self) -> ServerConfigResponse:
        plugins = [
            PluginInfo(
                name=plugin.name,
                support_gen_image=plugin.support_gen_image,
                support_gen_mask=plugin.support_gen_mask,
            )
            for plugin in self.plugins.values()
        ]
        return ServerConfigResponse(
            plugins=plugins,
            modelInfos=self.model_manager.scan_models(),
            removeBGModel=self.config.remove_bg_model,
            removeBGModels=RemoveBGModel.values(),
            realesrganModel=self.config.realesrgan_model,
            realesrganModels=RealESRGANModel.values(),
            interactiveSegModel=self.config.interactive_seg_model,
            interactiveSegModels=InteractiveSegModel.values(),
            enableFileManager=self.file_manager is not None,
            enableAutoSaving=self.config.output_dir is not None,
            enableControlnet=self.model_manager.enable_controlnet,
            controlnetMethod=self.model_manager.controlnet_method,
            disableModelSwitch=True,
            isDesktop=False,
            samplers=self.api_samplers(),
            cachedModels=self.model_manager.cached_model_names(),
            enableAuth=not self.config.disable_auth,
        )

    def api_vram_status(self) -> VramStatusResponse:
        cached = self.model_manager.cached_model_names()
        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            return VramStatusResponse(
                allocated_gb=torch.cuda.memory_allocated() / (1024 ** 3),
                reserved_gb=torch.cuda.memory_reserved() / (1024 ** 3),
                total_gb=props.total_memory / (1024 ** 3),
                cached_models=cached,
            )
        return VramStatusResponse(cached_models=cached)

    def api_input_image(self) -> FileResponse:
        if self.config.input is None:
            raise HTTPException(status_code=200, detail="No input image configured")
        if self.config.input.is_file():
            return FileResponse(self.config.input)
        raise HTTPException(status_code=404, detail="Input image not found")

    def api_geninfo(self, file: UploadFile) -> GenInfoResponse:
        _, _, info = load_img(file.file.read(), return_info=True)
        parts = info.get("parameters", "").split("Negative prompt: ")
        prompt = parts[0].strip()
        negative_prompt = ""
        if len(parts) > 1:
            negative_prompt = parts[1].split("\n")[0].strip()
        return GenInfoResponse(prompt=prompt, negative_prompt=negative_prompt)

    def api_inpaint(
        self,
        req: InpaintRequest,
        current_user: Optional[User] = Depends(get_optional_user),
        db: Session = Depends(get_db),
    ):
        image, alpha_channel, infos, ext = decode_base64_to_image(req.image)
        mask, _, _, _ = decode_base64_to_image(req.mask, gray=True)
        logger.info(f"image ext: {ext}")

        mask = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)[1]
        if image.shape[:2] != mask.shape[:2]:
            raise HTTPException(400, detail=f"Image size({image.shape[:2]}) and mask size({mask.shape[:2]}) not match.")

        start = time.time()
        task_type = req.task_type or ("outpaint" if req.use_extender else "inpaint")
        if task_type == "outpaint":
            req.prompt = ""
            req.negative_prompt = ""

        with self.queue_lock:
            self._start_cancelable_task(f"inpaint:{task_type}")
            try:
                from artie.const import REPAINT_MODEL

                task_model_map = {"inpaint": "lama", "outpaint": REPAINT_MODEL, "repaint": REPAINT_MODEL}
                if task_type not in task_model_map:
                    raise HTTPException(status_code=422, detail=f"Unsupported task type: {task_type}")

                target_model = task_model_map[task_type]
                if target_model not in self.model_manager.available_models:
                    raise HTTPException(status_code=422, detail=f"Required model for {task_type} is not available: {target_model}")
                before_model = self.model_manager.name
                switched = False
                if target_model != self.model_manager.name:
                    switch_variant = "default"
                    if (
                        task_type == "repaint"
                        and self.model_manager.available_models[target_model].model_type == ModelType.DIFFUSERS_SDXL
                    ):
                        switch_variant = "inpaint_compat"
                    self.model_manager.switch(target_model, variant=switch_variant)
                    switched = True
                if task_type == "outpaint" and not self.model_manager.current_model.support_outpainting:
                    raise HTTPException(status_code=422, detail=f"Model {self.model_manager.name} does not support outpainting")
                self._log_exec(
                    op="inpaint",
                    task_type=task_type,
                    requested_model=None,
                    before_model=before_model,
                    target_model=target_model,
                    switched=switched,
                    seed=req.sd_seed,
                )
                if self.cancel_event.is_set():
                    raise TaskCancelledError("Inpaint canceled by user")
                rgb_np_img = self.model_manager(image, mask, req)
            except TaskCancelledError:
                asyncio.run(self.sio.emit("diffusion_finish"))
                raise HTTPException(status_code=409, detail="Inpainting canceled by user")
            except NotImplementedError as e:
                raise HTTPException(status_code=422, detail=str(e))
            finally:
                self._finish_cancelable_task()

        duration_ms = int((time.time() - start) * 1000)
        logger.info(f"process time: {duration_ms:.2f}ms")
        torch_gc()

        rgb_np_img = cv2.cvtColor(rgb_np_img.astype(np.uint8), cv2.COLOR_BGR2RGB)
        rgb_res = concat_alpha_channel(rgb_np_img, alpha_channel)
        res_img_bytes = pil_to_bytes(Image.fromarray(rgb_res), ext=ext, quality=self.config.quality, infos=infos)
        asyncio.run(self.sio.emit("diffusion_finish"))

        self._create_operation_log(
            db=db,
            user=current_user,
            session_id=req.session_id,
            feature=task_type,
            operation="inpaint",
            model_name=self.model_manager.name,
            plugin_name=None,
            duration_ms=duration_ms,
            request_data=self._safe_json(req),
            response_data={"seed": req.sd_seed, "width": image.shape[1], "height": image.shape[0]},
        )

        return Response(content=res_img_bytes, media_type=f"image/{ext}", headers={"X-Seed": str(req.sd_seed)})

    def api_txt2img(
        self,
        req: Txt2ImgRequest,
        current_user: Optional[User] = Depends(get_optional_user),
        db: Session = Depends(get_db),
    ):
        start = time.time()
        with self.queue_lock:
            self._start_cancelable_task("txt2img")
            try:
                before_model = self.model_manager.name
                target_model = req.model_name or self.model_manager.name
                switched = False
                if req.model_name:
                    if req.model_name not in self.model_manager.available_models:
                        raise HTTPException(status_code=422, detail=f"Requested model is not available: {req.model_name}")
                    if not self.model_manager.available_models[req.model_name].support_txt2img:
                        raise HTTPException(status_code=422, detail=f"Requested model {req.model_name} does not support text-to-image generation")
                    if req.model_name != self.model_manager.name:
                        self.model_manager.switch(req.model_name)
                        switched = True
                if not self.model_manager.current_model.support_txt2img:
                    raise HTTPException(status_code=422, detail=f"Current model {self.model_manager.name} does not support text-to-image generation")
                self._log_exec(
                    op="txt2img",
                    task_type=None,
                    requested_model=req.model_name,
                    before_model=before_model,
                    target_model=target_model,
                    switched=switched,
                    seed=req.sd_seed,
                )
                if self.cancel_event.is_set():
                    raise TaskCancelledError("Txt2img canceled by user")
                bgr_np_img = self.model_manager.txt2img(req)
            except TaskCancelledError:
                asyncio.run(self.sio.emit("diffusion_finish"))
                raise HTTPException(status_code=409, detail="Text-to-image generation canceled by user")
            except NotImplementedError as e:
                raise HTTPException(status_code=422, detail=str(e))
            finally:
                self._finish_cancelable_task()

        duration_ms = int((time.time() - start) * 1000)
        logger.info(f"txt2img process time: {duration_ms:.2f}ms")
        rgb_np_img = cv2.cvtColor(bgr_np_img.astype(np.uint8), cv2.COLOR_BGR2RGB)
        res_img_bytes = pil_to_bytes(Image.fromarray(rgb_np_img), ext="png", quality=self.config.quality, infos={})
        asyncio.run(self.sio.emit("diffusion_finish"))

        self._create_operation_log(
            db=db,
            user=current_user,
            session_id=req.session_id,
            feature="generate",
            operation="txt2img",
            model_name=self.model_manager.name,
            plugin_name=None,
            duration_ms=duration_ms,
            request_data=self._safe_json(req),
            response_data={"seed": req.sd_seed, "width": req.width, "height": req.height},
        )

        return Response(content=res_img_bytes, media_type="image/png", headers={"X-Seed": str(req.sd_seed)})

    def api_run_plugin_gen_image(
        self,
        req: RunPluginRequest,
        current_user: Optional[User] = Depends(get_optional_user),
        db: Session = Depends(get_db),
    ):
        if req.name not in self.plugins:
            raise HTTPException(status_code=422, detail="Plugin not found")
        if not self.plugins[req.name].support_gen_image:
            raise HTTPException(status_code=422, detail="Plugin does not support output image")
        start = time.time()
        rgb_np_img, alpha_channel, infos, _ = decode_base64_to_image(req.image)
        bgr_or_rgba_np_img = self.plugins[req.name].gen_image(rgb_np_img, req)
        torch_gc()

        if bgr_or_rgba_np_img.shape[2] == 4:
            rgba_np_img = bgr_or_rgba_np_img
        else:
            rgba_np_img = cv2.cvtColor(bgr_or_rgba_np_img, cv2.COLOR_BGR2RGB)
            rgba_np_img = concat_alpha_channel(rgba_np_img, alpha_channel)

        duration_ms = int((time.time() - start) * 1000)
        self._create_operation_log(
            db=db,
            user=current_user,
            session_id=req.session_id,
            feature=req.name,
            operation="plugin_image",
            model_name=None,
            plugin_name=req.name,
            duration_ms=duration_ms,
            request_data=self._safe_json(req),
            response_data={"width": rgba_np_img.shape[1], "height": rgba_np_img.shape[0]},
        )
        return Response(
            content=pil_to_bytes(Image.fromarray(rgba_np_img), ext="png", quality=self.config.quality, infos=infos),
            media_type="image/png",
        )

    def api_run_plugin_gen_mask(
        self,
        req: RunPluginRequest,
        current_user: Optional[User] = Depends(get_optional_user),
        db: Session = Depends(get_db),
    ):
        if req.name not in self.plugins:
            raise HTTPException(status_code=422, detail="Plugin not found")
        if not self.plugins[req.name].support_gen_mask:
            raise HTTPException(status_code=422, detail="Plugin does not support output image")
        start = time.time()
        rgb_np_img, _, _, _ = decode_base64_to_image(req.image)
        bgr_or_gray_mask = self.plugins[req.name].gen_mask(rgb_np_img, req)
        torch_gc()
        duration_ms = int((time.time() - start) * 1000)
        self._create_operation_log(
            db=db,
            user=current_user,
            session_id=req.session_id,
            feature=req.name,
            operation="plugin_mask",
            model_name=None,
            plugin_name=req.name,
            duration_ms=duration_ms,
            request_data=self._safe_json(req),
            response_data={},
        )
        return Response(content=numpy_to_bytes(gen_frontend_mask(bgr_or_gray_mask), "png"), media_type="image/png")

    def api_samplers(self) -> List[str]:
        return [member.value for member in SDSampler.__members__.values()]

    def api_adjust_mask(self, req: AdjustMaskRequest):
        mask, _, _, _ = decode_base64_to_image(req.mask, gray=True)
        mask = adjust_mask(mask, req.kernel_size, req.operate)
        return Response(content=numpy_to_bytes(mask, "png"), media_type="image/png")

    def api_register(self, req: UserCreate, db: Session = Depends(get_db)):
        if db_crud.get_user_by_username(db, req.username):
            raise HTTPException(status_code=400, detail="Username already registered")
        if db_crud.get_user_by_email(db, req.email):
            raise HTTPException(status_code=400, detail="Email already registered")
        user = db_crud.create_user(db, req.username, req.email, hash_password(req.password))
        return user

    def api_login(self, req: UserLogin, db: Session = Depends(get_db)):
        user = db_crud.get_user_by_username(db, req.username)
        if not user or not verify_password(req.password, user.hashed_password):
            raise HTTPException(status_code=401, detail="Incorrect username or password")
        db_crud.update_user_last_login(db, user)
        self._create_activity(db=db, user=user, session_id=None, event_type="login", feature=None, detail={})
        return TokenResponse(access_token=create_access_token(user.id))

    def api_me(self, current_user: User = Depends(get_current_user)):
        return current_user

    def api_list_workspaces(
        self,
        search: Optional[str] = Query(None),
        feature: Optional[str] = Query(None),
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        sessions = db_crud.list_workspace_sessions(db, current_user.id, search=search, feature=feature, limit=200)
        return [self._session_to_summary(session) for session in sessions]

    def api_save_workspace(
        self,
        req: SaveWorkspaceRequest,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> WorkspaceDetailResponse:
        session = self._require_workspace_session(db, current_user, req.session_id)
        if session is None:
            session = db_crud.create_workspace_session(
                db=db,
                user_id=current_user.id,
                title=self._workspace_title(req.active_tab, req.title),
                source_feature=req.active_tab,
                current_feature=req.active_tab,
            )
        else:
            db_crud.touch_workspace_session(
                db,
                session,
                title=self._workspace_title(req.active_tab, req.title),
                current_feature=req.active_tab,
            )

        asset_roles: dict[str, str] = {}
        for asset in req.assets:
            created = self._create_asset_from_upload(
                db=db,
                user=current_user,
                session_id=session.id,
                active_tab=req.active_tab,
                role=asset.role,
                kind=asset.kind,
                data_url=asset.data,
                filename=asset.filename,
                label=asset.label,
                width=asset.width,
                height=asset.height,
                mime_type=asset.mime_type,
                metadata=asset.metadata,
            )
            asset_roles[asset.role] = created.id

        primary_asset_id = asset_roles.get("primary") or asset_roles.get("result") or asset_roles.get("source")
        mask_asset_id = asset_roles.get("mask")
        preview_asset_id = asset_roles.get("preview") or primary_asset_id

        snapshot = db_crud.create_snapshot(
            db=db,
            session_id=session.id,
            user_id=current_user.id,
            title=req.title,
            active_tab=req.active_tab,
            primary_asset_id=primary_asset_id,
            mask_asset_id=mask_asset_id,
            preview_asset_id=preview_asset_id,
            asset_roles=asset_roles,
            workspace_state=req.workspace_state,
        )
        db_crud.upsert_feature_states(db, session.id, req.settings_by_feature)
        db_crud.touch_workspace_session(
            db,
            session,
            title=self._workspace_title(req.active_tab, req.title),
            current_feature=req.active_tab,
            current_snapshot_id=snapshot.id,
            current_asset_id=primary_asset_id,
            current_mask_asset_id=mask_asset_id,
            current_preview_asset_id=preview_asset_id,
        )

        op = self._create_operation_log(
            db=db,
            user=current_user,
            session_id=session.id,
            feature=req.active_tab,
            operation="manual_save",
            model_name=None,
            plugin_name=None,
            duration_ms=None,
            request_data={"asset_roles": list(asset_roles.keys())},
            response_data={"snapshot_id": snapshot.id},
        )
        if op:
            db_crud.touch_workspace_session(db, session, last_operation_id=op.id)
        self._create_activity(
            db=db,
            user=current_user,
            session_id=session.id,
            event_type="manual_save",
            feature=req.active_tab,
            detail={"snapshot_id": snapshot.id},
        )

        fresh = db_crud.get_workspace_session(db, session.id, current_user.id)
        latest_snapshot = next((item for item in fresh.snapshots if item.id == fresh.current_snapshot_id), None)
        operations = [self._operation_to_response(item) for item in db_crud.list_operation_runs(db, fresh.id, current_user.id, 50)]
        return WorkspaceDetailResponse(
            session=self._session_to_summary(fresh),
            latest_snapshot=self._snapshot_to_response(latest_snapshot),
            feature_states=db_crud.get_feature_states_map(fresh),
            operations=operations,
        )

    def api_import_workspace(
        self,
        file: UploadFile,
        title: Optional[str] = Query(None),
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> WorkspaceImportResponse:
        content = file.file.read()
        guessed_type = file.content_type or "image/png"
        data_url = f"data:{guessed_type};base64,{base64.b64encode(content).decode('utf-8')}"
        session = db_crud.create_workspace_session(
            db=db,
            user_id=current_user.id,
            title=self._workspace_title("inpaint", title or file.filename),
            source_feature="inpaint",
            current_feature="inpaint",
        )
        asset = self._create_asset_from_upload(
            db=db,
            user=current_user,
            session_id=session.id,
            active_tab="inpaint",
            role="primary",
            kind="uploaded",
            data_url=data_url,
            filename=file.filename,
            label=file.filename,
            width=None,
            height=None,
            mime_type=guessed_type,
            metadata={},
        )
        snapshot = db_crud.create_snapshot(
            db=db,
            session_id=session.id,
            user_id=current_user.id,
            title=title,
            active_tab="inpaint",
            primary_asset_id=asset.id,
            mask_asset_id=None,
            preview_asset_id=asset.id,
            asset_roles={"primary": asset.id, "source": asset.id, "preview": asset.id},
            workspace_state={"imported": True},
        )
        db_crud.touch_workspace_session(
            db,
            session,
            current_snapshot_id=snapshot.id,
            current_asset_id=asset.id,
            current_preview_asset_id=asset.id,
        )
        self._create_activity(db=db, user=current_user, session_id=session.id, event_type="import", feature="inpaint", detail={"filename": file.filename})
        return WorkspaceImportResponse(id=snapshot.id, name=file.filename or "uploaded", session_id=session.id, asset_id=asset.id, created_at=snapshot.created_at)

    def api_get_workspace(
        self,
        session_id: str,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> WorkspaceDetailResponse:
        session = self._require_workspace_session(db, current_user, session_id)
        latest_snapshot = next((item for item in session.snapshots if item.id == session.current_snapshot_id), None)
        operations = [self._operation_to_response(item) for item in db_crud.list_operation_runs(db, session.id, current_user.id, 100)]
        return WorkspaceDetailResponse(
            session=self._session_to_summary(session),
            latest_snapshot=self._snapshot_to_response(latest_snapshot),
            feature_states=db_crud.get_feature_states_map(session),
            operations=operations,
        )

    def api_resume_workspace(
        self,
        session_id: str,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> WorkspaceResumeResponse:
        session = self._require_workspace_session(db, current_user, session_id)
        snapshot = next((item for item in session.snapshots if item.id == session.current_snapshot_id), None)
        if snapshot is None:
            raise HTTPException(status_code=404, detail="Workspace snapshot not found")
        asset_ids = set(db_crud.loads_json(snapshot.asset_roles_json, {}).values())
        assets: dict[str, WorkspaceAssetInfo] = {}
        for asset_id in asset_ids:
            asset = db_crud.get_asset(db, asset_id, current_user.id)
            if asset:
                assets[asset.id] = self._asset_to_response(asset)
        self._create_activity(db=db, user=current_user, session_id=session.id, event_type="resume", feature=snapshot.active_tab, detail={"snapshot_id": snapshot.id})
        return WorkspaceResumeResponse(
            session=self._session_to_summary(session),
            snapshot=self._snapshot_to_response(snapshot),
            feature_states=db_crud.get_feature_states_map(session),
            assets=assets,
        )

    def api_list_workspace_operations(
        self,
        session_id: str,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        _ = self._require_workspace_session(db, current_user, session_id)
        return [self._operation_to_response(item) for item in db_crud.list_operation_runs(db, session_id, current_user.id, 200)]

    def api_delete_workspace(
        self,
        session_id: str,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        session = self._require_workspace_session(db, current_user, session_id)
        db_crud.soft_delete_workspace_session(db, session)
        self._create_activity(db=db, user=current_user, session_id=session.id, event_type="delete", feature=session.current_feature, detail={})
        return {"ok": True}

    def api_get_asset_file(self, asset_id: str, request: Request, db: Session = Depends(get_db)):
        current_user = self._resolve_asset_request_user(request, db)
        asset = db_crud.get_asset(db, asset_id, current_user.id)
        if asset is None:
            raise HTTPException(status_code=404, detail="Asset not found")
        asset_file = db_crud.get_asset_primary_file(asset)
        if asset_file is None:
            raise HTTPException(status_code=404, detail="Asset file not found")
        file_path = Path(asset_file.storage_path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Asset file missing on disk")
        return FileResponse(file_path, media_type=asset_file.mime_type or "image/png", filename=asset_file.filename)

    def launch(self):
        self.app.include_router(self.router)
        uvicorn.run(self.combined_asgi_app, host=self.config.host, port=self.config.port, timeout_keep_alive=999999999)

    def _build_file_manager(self) -> Optional[FileManager]:
        if self.config.input and self.config.input.is_dir():
            logger.info(f"Input is directory, initialize file manager {self.config.input}")
            return FileManager(
                app=self.app,
                input_dir=self.config.input,
                mask_dir=self.config.mask_dir,
                output_dir=self.config.output_dir,
            )
        return None

    def _build_plugins(self) -> Dict[str, BasePlugin]:
        return build_plugins(
            self.config.enable_interactive_seg,
            self.config.interactive_seg_model,
            self.config.interactive_seg_device,
            self.config.enable_remove_bg,
            self.config.remove_bg_device,
            self.config.remove_bg_model,
            self.config.enable_anime_seg,
            self.config.enable_realesrgan,
            self.config.realesrgan_device,
            self.config.realesrgan_model,
            self.config.enable_gfpgan,
            self.config.gfpgan_device,
            self.config.enable_restoreformer,
            self.config.restoreformer_device,
            self.config.no_half,
            self.config.local_files_only,
        )

    def _build_model_manager(self):
        return ModelManager(
            name=self.config.model,
            device=torch.device(self.config.device),
            no_half=self.config.no_half,
            low_mem=self.config.low_mem,
            disable_nsfw=self.config.disable_nsfw_checker,
            sd_cpu_textencoder=self.config.cpu_textencoder,
            local_files_only=self.config.local_files_only,
            cpu_offload=self.config.cpu_offload,
            callback=diffuser_callback,
            max_cached_models=self.config.max_cached_models,
            max_vram_usage_gb=self.config.max_vram_usage_gb,
        )
