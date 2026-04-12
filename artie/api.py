import asyncio
import os
import threading
import time
import traceback
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, List

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
except:
    pass

import uvicorn
from PIL import Image
from fastapi import APIRouter, FastAPI, Request, UploadFile, Depends, Query
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer
from loguru import logger
from socketio import AsyncServer
from sqlalchemy.orm import Session

from artie.auth import (
    init_auth,
    get_current_user,
    get_optional_user,
    hash_password,
    verify_password,
    create_access_token,
)
from artie.db.database import init_db, get_db
from artie.db import crud as db_crud
from artie.db.models import User
from artie.file_manager import FileManager
from artie.helper import (
    load_img,
    decode_base64_to_image,
    pil_to_bytes,
    numpy_to_bytes,
    concat_alpha_channel,
    gen_frontend_mask,
    adjust_mask,
)
from artie.model.utils import torch_gc
from artie.model_manager import ModelManager
from artie.plugins import build_plugins, RealESRGANUpscaler, InteractiveSeg
from artie.plugins.base_plugin import BasePlugin
from artie.plugins.remove_bg import RemoveBG
from artie.schema import (
    GenInfoResponse,
    ApiConfig,
    ServerConfigResponse,
    SwitchModelRequest,
    InpaintRequest,
    RunPluginRequest,
    SDSampler,
    PluginInfo,
    AdjustMaskRequest,
    RemoveBGModel,
    SwitchPluginModelRequest,
    ModelInfo,
    InteractiveSegModel,
    RealESRGANModel,
    Txt2ImgRequest,
    SwitchTabRequest,
    ModelType,
    VramStatusResponse,
    UserCreate,
    UserLogin,
    UserResponse,
    TokenResponse,
    ProjectCreate,
    ProjectResponse,
    ImageResponse,
)

CURRENT_DIR = Path(__file__).parent.absolute().resolve()
WEB_APP_DIR = CURRENT_DIR / "web_app"


def api_middleware(app: FastAPI):
    rich_available = False
    try:
        if os.environ.get("WEBUI_RICH_EXCEPTIONS", None) is not None:
            import anyio  # importing just so it can be placed on silent list
            import starlette  # importing just so it can be placed on silent list
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
        if not isinstance(
            e, HTTPException
        ):  # do not print backtrace on known httpexceptions
            message = f"API error: {request.method}: {request.url} {err}"
            if rich_available:
                print(message)
                console.print_exception(
                    show_locals=True,
                    max_frames=2,
                    extra_lines=1,
                    suppress=[anyio, starlette],
                    word_wrap=False,
                    width=min([console.width, 200]),
                )
            else:
                traceback.print_exc()
        return JSONResponse(
            status_code=vars(e).get("status_code", 500), content=jsonable_encoder(err)
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

    cors_options = {
        "allow_methods": ["*"],
        "allow_headers": ["*"],
        "allow_origins": ["*"],
        "allow_credentials": True,
        "expose_headers": ["X-Seed"],
    }
    app.add_middleware(CORSMiddleware, **cors_options)


global_sio: AsyncServer = None
global_api: "Api" = None


class TaskCancelledError(RuntimeError):
    pass


def diffuser_callback(pipe, step: int, timestep: int, callback_kwargs: Dict = {}):
    # self: DiffusionPipeline, step: int, timestep: int, callback_kwargs: Dict
    # logger.info(f"diffusion callback: step={step}, timestep={timestep}")
    if global_api is not None and global_api.cancel_event.is_set():
        raise TaskCancelledError("Task canceled by user")

    # We use asyncio loos for task processing. Perhaps in the future, we can add a processing queue similar to InvokeAI,
    # but for now let's just start a separate event loop. It shouldn't make a difference for single person use
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

        # Initialize database and auth
        init_db(config.db_path)
        init_auth(config.auth_secret_key, config.disable_auth)

        self.file_manager = self._build_file_manager()
        self.plugins = self._build_plugins()
        self.model_manager = self._build_model_manager()

        # fmt: off
        self.add_api_route("/api/v1/gen-info", self.api_geninfo, methods=["POST"], response_model=GenInfoResponse)
        self.add_api_route("/api/v1/server-config", self.api_server_config, methods=["GET"],
                           response_model=ServerConfigResponse)
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

        # Auth routes
        self.add_api_route("/api/v1/auth/register", self.api_register, methods=["POST"], response_model=UserResponse)
        self.add_api_route("/api/v1/auth/login", self.api_login, methods=["POST"], response_model=TokenResponse)
        self.add_api_route("/api/v1/auth/me", self.api_me, methods=["GET"], response_model=UserResponse)

        # Project routes
        self.add_api_route("/api/v1/projects", self.api_list_projects, methods=["GET"])
        self.add_api_route("/api/v1/projects", self.api_create_project, methods=["POST"], response_model=ProjectResponse)
        self.add_api_route("/api/v1/projects/{project_id}", self.api_delete_project, methods=["DELETE"])

        # Image routes
        self.add_api_route("/api/v1/images", self.api_list_images, methods=["GET"])
        self.add_api_route("/api/v1/images/{image_id}", self.api_get_image, methods=["GET"], response_model=ImageResponse)
        self.add_api_route("/api/v1/images/{image_id}/file", self.api_get_image_file, methods=["GET"])
        self.add_api_route("/api/v1/images/{image_id}", self.api_delete_image, methods=["DELETE"])

        self.app.mount("/", StaticFiles(directory=WEB_APP_DIR, html=True), name="assets")
        # fmt: on

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

    def api_save_image(self, file: UploadFile):
        # Ensure output directory exists
        if not self.config.output_dir or not self.config.output_dir.exists():
            raise HTTPException(
                status_code=400,
                detail="Output directory not configured or doesn't exist",
            )

        # Sanitize filename to prevent path traversal
        safe_filename = Path(file.filename).name  # Get just the filename component

        # Construct the full path within output_dir
        output_path = self.config.output_dir / safe_filename

        # Read and write the file
        origin_image_bytes = file.file.read()
        with open(output_path, "wb") as fw:
            fw.write(origin_image_bytes)

    def api_current_model(self) -> ModelInfo:
        return self.model_manager.current_model

    def api_switch_model(self, req: SwitchModelRequest) -> ModelInfo:
        with self.queue_lock:
            if req.name == self.model_manager.name:
                return self.model_manager.current_model
            self.model_manager.switch(req.name)
            return self.model_manager.current_model

    def api_switch_tab(self, req: SwitchTabRequest) -> ModelInfo:
        # Compatibility endpoint: tab switching no longer performs backend model switch.
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
        plugins = []
        for it in self.plugins.values():
            plugins.append(
                PluginInfo(
                    name=it.name,
                    support_gen_image=it.support_gen_image,
                    support_gen_mask=it.support_gen_mask,
                )
            )

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
            raise HTTPException(
                400,
                detail=f"Image size({image.shape[:2]}) and mask size({mask.shape[:2]}) not match.",
            )

        start = time.time()
        task_type = req.task_type or ("outpaint" if req.use_extender else "inpaint")
        if task_type == "outpaint":
            # Outpaint is promptless in UI and API contract.
            req.prompt = ""
            req.negative_prompt = ""
        with self.queue_lock:
            self._start_cancelable_task(f"inpaint:{task_type}")
            try:
                from artie.const import REPAINT_MODEL

                task_model_map = {
                    "inpaint": "lama",
                    "outpaint": REPAINT_MODEL,
                    "repaint": REPAINT_MODEL,
                }
                if task_type not in task_model_map:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Unsupported task type: {task_type}",
                    )

                target_model = task_model_map[task_type]
                if target_model not in self.model_manager.available_models:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Required model for {task_type} is not available: {target_model}",
                    )
                before_model = self.model_manager.name
                switched = False
                if target_model != self.model_manager.name:
                    switch_variant = "default"
                    if (
                        task_type == "repaint"
                        and self.model_manager.available_models[
                            target_model
                        ].model_type
                        == ModelType.DIFFUSERS_SDXL
                    ):
                        switch_variant = "inpaint_compat"
                    self.model_manager.switch(target_model, variant=switch_variant)
                    switched = True
                if task_type == "outpaint" and not self.model_manager.current_model.support_outpainting:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Model {self.model_manager.name} does not support outpainting",
                    )
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
        logger.info(f"process time: {(time.time() - start) * 1000:.2f}ms")
        torch_gc()

        rgb_np_img = cv2.cvtColor(rgb_np_img.astype(np.uint8), cv2.COLOR_BGR2RGB)
        rgb_res = concat_alpha_channel(rgb_np_img, alpha_channel)

        res_img_bytes = pil_to_bytes(
            Image.fromarray(rgb_res),
            ext=ext,
            quality=self.config.quality,
            infos=infos,
        )

        asyncio.run(self.sio.emit("diffusion_finish"))

        # Optionally persist to user workspace
        if current_user is not None:
            self._save_to_user_workspace(
                db=db,
                user=current_user,
                image_bytes=res_img_bytes,
                ext=ext,
                image_type="inpainted",
                prompt=req.prompt,
                negative_prompt=req.negative_prompt,
                seed=req.sd_seed,
                width=image.shape[1],
                height=image.shape[0],
            )

        return Response(
            content=res_img_bytes,
            media_type=f"image/{ext}",
            headers={"X-Seed": str(req.sd_seed)},
        )

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
                        raise HTTPException(
                            status_code=422,
                            detail=f"Requested model is not available: {req.model_name}",
                        )
                    if not self.model_manager.available_models[req.model_name].support_txt2img:
                        raise HTTPException(
                            status_code=422,
                            detail=f"Requested model {req.model_name} does not support text-to-image generation",
                        )
                    if req.model_name != self.model_manager.name:
                        self.model_manager.switch(req.model_name)
                        switched = True
                if not self.model_manager.current_model.support_txt2img:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Current model {self.model_manager.name} does not support text-to-image generation",
                    )
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
        logger.info(f"txt2img process time: {(time.time() - start) * 1000:.2f}ms")

        rgb_np_img = cv2.cvtColor(bgr_np_img.astype(np.uint8), cv2.COLOR_BGR2RGB)

        ext = "png"
        res_img_bytes = pil_to_bytes(
            Image.fromarray(rgb_np_img),
            ext=ext,
            quality=self.config.quality,
            infos={},
        )

        asyncio.run(self.sio.emit("diffusion_finish"))

        # Optionally persist to user workspace
        if current_user is not None:
            self._save_to_user_workspace(
                db=db,
                user=current_user,
                image_bytes=res_img_bytes,
                ext=ext,
                image_type="generated",
                prompt=req.prompt,
                negative_prompt=req.negative_prompt,
                seed=req.sd_seed,
                width=req.width,
                height=req.height,
            )

        return Response(
            content=res_img_bytes,
            media_type=f"image/{ext}",
            headers={"X-Seed": str(req.sd_seed)},
        )

    def api_run_plugin_gen_image(self, req: RunPluginRequest):
        ext = "png"
        if req.name not in self.plugins:
            raise HTTPException(status_code=422, detail="Plugin not found")
        if not self.plugins[req.name].support_gen_image:
            raise HTTPException(
                status_code=422, detail="Plugin does not support output image"
            )
        rgb_np_img, alpha_channel, infos, _ = decode_base64_to_image(req.image)
        bgr_or_rgba_np_img = self.plugins[req.name].gen_image(rgb_np_img, req)
        torch_gc()

        if bgr_or_rgba_np_img.shape[2] == 4:
            rgba_np_img = bgr_or_rgba_np_img
        else:
            rgba_np_img = cv2.cvtColor(bgr_or_rgba_np_img, cv2.COLOR_BGR2RGB)
            rgba_np_img = concat_alpha_channel(rgba_np_img, alpha_channel)

        return Response(
            content=pil_to_bytes(
                Image.fromarray(rgba_np_img),
                ext=ext,
                quality=self.config.quality,
                infos=infos,
            ),
            media_type=f"image/{ext}",
        )

    def api_run_plugin_gen_mask(self, req: RunPluginRequest):
        if req.name not in self.plugins:
            raise HTTPException(status_code=422, detail="Plugin not found")
        if not self.plugins[req.name].support_gen_mask:
            raise HTTPException(
                status_code=422, detail="Plugin does not support output image"
            )
        rgb_np_img, _, _, _ = decode_base64_to_image(req.image)
        bgr_or_gray_mask = self.plugins[req.name].gen_mask(rgb_np_img, req)
        torch_gc()
        res_mask = gen_frontend_mask(bgr_or_gray_mask)
        return Response(
            content=numpy_to_bytes(res_mask, "png"),
            media_type="image/png",
        )

    def api_samplers(self) -> List[str]:
        return [member.value for member in SDSampler.__members__.values()]

    def api_adjust_mask(self, req: AdjustMaskRequest):
        mask, _, _, _ = decode_base64_to_image(req.mask, gray=True)
        mask = adjust_mask(mask, req.kernel_size, req.operate)
        return Response(content=numpy_to_bytes(mask, "png"), media_type="image/png")

    # ------------------------------------------------------------------
    # Auth routes
    # ------------------------------------------------------------------

    def api_register(self, req: UserCreate, db: Session = Depends(get_db)):
        if db_crud.get_user_by_username(db, req.username):
            raise HTTPException(status_code=400, detail="Username already registered")
        if db_crud.get_user_by_email(db, req.email):
            raise HTTPException(status_code=400, detail="Email already registered")
        hashed = hash_password(req.password)
        user = db_crud.create_user(db, req.username, req.email, hashed)
        return user

    def api_login(self, req: UserLogin, db: Session = Depends(get_db)):
        user = db_crud.get_user_by_username(db, req.username)
        if not user or not verify_password(req.password, user.hashed_password):
            raise HTTPException(status_code=401, detail="Incorrect username or password")
        db_crud.update_user_last_login(db, user)
        token = create_access_token(user.id)
        return TokenResponse(access_token=token)

    def api_me(self, current_user: User = Depends(get_current_user)):
        return current_user

    # ------------------------------------------------------------------
    # Project routes
    # ------------------------------------------------------------------

    def api_list_projects(
        self,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        projects = db_crud.get_projects(db, current_user.id)
        result = []
        for p in projects:
            image_count = len(p.images)
            result.append(ProjectResponse(
                id=p.id,
                name=p.name,
                description=p.description,
                image_count=image_count,
                created_at=p.created_at,
                updated_at=p.updated_at,
            ))
        return result

    def api_create_project(
        self,
        req: ProjectCreate,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> ProjectResponse:
        project = db_crud.create_project(db, current_user.id, req.name, req.description)
        return ProjectResponse(
            id=project.id,
            name=project.name,
            description=project.description,
            image_count=0,
            created_at=project.created_at,
            updated_at=project.updated_at,
        )

    def api_delete_project(
        self,
        project_id: str,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        deleted = db_crud.delete_project(db, project_id, current_user.id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Project not found")
        return {"ok": True}

    # ------------------------------------------------------------------
    # Image routes
    # ------------------------------------------------------------------

    def api_list_images(
        self,
        project_id: Optional[str] = Query(None),
        image_type: Optional[str] = Query(None),
        skip: int = Query(0, ge=0),
        limit: int = Query(50, ge=1, le=200),
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        images = db_crud.get_images(db, current_user.id, project_id, image_type, skip, limit)
        return [ImageResponse.model_validate(img) for img in images]

    def api_get_image(
        self,
        image_id: str,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> ImageResponse:
        image = db_crud.get_image(db, image_id, current_user.id)
        if not image:
            raise HTTPException(status_code=404, detail="Image not found")
        return ImageResponse.model_validate(image)

    def api_get_image_file(
        self,
        image_id: str,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        image = db_crud.get_image(db, image_id, current_user.id)
        if not image:
            raise HTTPException(status_code=404, detail="Image not found")
        p = Path(image.storage_path)
        if not p.exists():
            raise HTTPException(status_code=404, detail="Image file not found on disk")
        return FileResponse(p, media_type="image/png", filename=image.filename)

    def api_delete_image(
        self,
        image_id: str,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        deleted = db_crud.delete_image(db, image_id, current_user.id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Image not found")
        return {"ok": True}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _save_to_user_workspace(
        self,
        db: Session,
        user: User,
        image_bytes: bytes,
        ext: str,
        image_type: str,
        prompt: Optional[str] = None,
        negative_prompt: Optional[str] = None,
        seed: Optional[int] = None,
        width: Optional[int] = None,
        height: Optional[int] = None,
    ):
        """Save image bytes to per-user storage and create a DB record."""
        try:
            from artie.db.database import ARTIE_HOME
            user_dir = ARTIE_HOME / "users" / user.id / image_type
            user_dir.mkdir(parents=True, exist_ok=True)

            filename = f"{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.{ext}"
            storage_path = user_dir / filename
            storage_path.write_bytes(image_bytes)

            project = db_crud.get_or_create_default_project(db, user.id)
            db_crud.create_image(
                db=db,
                user_id=user.id,
                filename=filename,
                storage_path=str(storage_path),
                image_type=image_type,
                project_id=project.id,
                prompt=prompt,
                negative_prompt=negative_prompt,
                seed=seed,
                model_name=self.model_manager.name,
                width=width,
                height=height,
            )
        except Exception as e:
            logger.warning(f"Failed to save image to user workspace: {e}")

    def launch(self):
        self.app.include_router(self.router)
        uvicorn.run(
            self.combined_asgi_app,
            host=self.config.host,
            port=self.config.port,
            timeout_keep_alive=999999999,
        )

    def _build_file_manager(self) -> Optional[FileManager]:
        if self.config.input and self.config.input.is_dir():
            logger.info(
                f"Input is directory, initialize file manager {self.config.input}"
            )

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
