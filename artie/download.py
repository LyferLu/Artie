import glob
import json
import os
from functools import lru_cache
from typing import List, Optional

from artie.schema import ModelType, ModelInfo
from loguru import logger
from pathlib import Path

from artie.const import (
    DEFAULT_MODEL_DIR,
    DIFFUSERS_SD_CLASS_NAME,
    DIFFUSERS_SD_INPAINT_CLASS_NAME,
    DIFFUSERS_SDXL_CLASS_NAME,
    DIFFUSERS_SDXL_INPAINT_CLASS_NAME,
    ANYTEXT_NAME,
)
from artie.model.original_sd_configs import get_config_files

PROJECT_ROOT = Path(__file__).resolve().parent.parent
HF_PROJECT_CONFIG_PATH = PROJECT_ROOT / "secrets.json"
HF_USER_CONFIG_PATH = Path.home() / ".artie" / "secrets.json"


def _hf_token_config_paths() -> List[Path]:
    # Project-local config has higher priority, user-level config is fallback.
    return [HF_PROJECT_CONFIG_PATH, HF_USER_CONFIG_PATH]


def _resolve_hf_token() -> tuple[Optional[str], Optional[Path]]:
    """
    Read HuggingFace token from local config file(s).
    Search order:
    1) <project>/secrets.json
    2) ~/.artie/secrets.json
    Expected JSON: {"hf_token": "hf_xxx"}
    """
    for cfg_path in _hf_token_config_paths():
        if not cfg_path.exists():
            continue
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            token = str(data.get("hf_token", "")).strip()
            if token:
                return token, cfg_path
        except Exception as e:
            logger.warning(f"Failed to read local token config {cfg_path}: {e}")
    return None, None


def _is_gated_repo_error(exc: Exception) -> bool:
    msg = str(exc)
    return (
        exc.__class__.__name__ == "GatedRepoError"
        or "Cannot access gated repo" in msg
        or ("Access to model" in msg and "is restricted" in msg)
        or "401 Client Error" in msg
    )


def cli_download_model(model: str):
    from artie.model import models
    from artie.model.utils import handle_from_pretrained_exceptions

    if model in models and models[model].is_erase_model:
        logger.info(f"Downloading {model}...")
        models[model].download()
        logger.info("Done.")
    elif model == ANYTEXT_NAME:
        logger.info(f"Downloading {model}...")
        models[model].download()
        logger.info("Done.")
    else:
        logger.info(f"Downloading model from Huggingface: {model}")
        from diffusers import DiffusionPipeline

        download_kwargs = {
            "pretrained_model_name": model,
            "variant": "fp16",
        }
        try:
            # First try anonymous/public download.
            downloaded_path = handle_from_pretrained_exceptions(
                DiffusionPipeline.download, **download_kwargs
            )
        except Exception as e:
            if not _is_gated_repo_error(e):
                raise

            token, token_path = _resolve_hf_token()
            if not token:
                config_paths = ", ".join(str(p) for p in _hf_token_config_paths())
                raise RuntimeError(
                    "检测到受限模型，需要 HuggingFace token。请在以下任一配置文件中写入 token：\n"
                    f"{config_paths}\n"
                    '示例内容: {"hf_token": "hf_xxx"}'
                ) from e

            logger.info(
                f"Model is gated, retry download with token from: {token_path}"
            )
            downloaded_path = handle_from_pretrained_exceptions(
                DiffusionPipeline.download,
                **{**download_kwargs, "token": token},
            )
        logger.info(f"Done. Downloaded to {downloaded_path}")


def folder_name_to_show_name(name: str) -> str:
    return name.replace("models--", "").replace("--", "/")


@lru_cache(maxsize=512)
def get_sd_model_type(model_abs_path: str) -> Optional[ModelType]:
    if "inpaint" in Path(model_abs_path).name.lower():
        model_type = ModelType.DIFFUSERS_SD_INPAINT
    else:
        # load once to check num_in_channels
        from diffusers import StableDiffusionInpaintPipeline

        try:
            StableDiffusionInpaintPipeline.from_single_file(
                model_abs_path,
                load_safety_checker=False,
                num_in_channels=9,
                original_config_file=get_config_files()["v1"],
            )
            model_type = ModelType.DIFFUSERS_SD_INPAINT
        except ValueError as e:
            if "[320, 4, 3, 3]" in str(e):
                model_type = ModelType.DIFFUSERS_SD
            else:
                logger.info(f"Ignore non sdxl file: {model_abs_path}")
                return
        except Exception as e:
            logger.error(f"Failed to load {model_abs_path}: {e}")
            return
    return model_type


@lru_cache()
def get_sdxl_model_type(model_abs_path: str) -> Optional[ModelType]:
    if "inpaint" in model_abs_path:
        model_type = ModelType.DIFFUSERS_SDXL_INPAINT
    else:
        # load once to check num_in_channels
        from diffusers import StableDiffusionXLInpaintPipeline

        try:
            model = StableDiffusionXLInpaintPipeline.from_single_file(
                model_abs_path,
                load_safety_checker=False,
                num_in_channels=9,
                original_config_file=get_config_files()["xl"],
            )
            if model.unet.config.in_channels == 9:
                # https://github.com/huggingface/diffusers/issues/6610
                model_type = ModelType.DIFFUSERS_SDXL_INPAINT
            else:
                model_type = ModelType.DIFFUSERS_SDXL
        except ValueError as e:
            if "[320, 4, 3, 3]" in str(e):
                model_type = ModelType.DIFFUSERS_SDXL
            else:
                logger.info(f"Ignore non sdxl file: {model_abs_path}")
                return
        except Exception as e:
            logger.error(f"Failed to load {model_abs_path}: {e}")
            return
    return model_type


def scan_single_file_diffusion_models(cache_dir) -> List[ModelInfo]:
    cache_dir = Path(cache_dir)
    stable_diffusion_dir = cache_dir / "stable_diffusion"
    cache_file = stable_diffusion_dir / "artie_cache.json"
    model_type_cache = {}
    if cache_file.exists():
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                model_type_cache = json.load(f)
                assert isinstance(model_type_cache, dict)
        except:
            pass

    res = []
    for it in stable_diffusion_dir.glob("*.*"):
        if it.suffix not in [".safetensors", ".ckpt"]:
            continue
        model_abs_path = str(it.absolute())
        model_type = model_type_cache.get(it.name)
        if model_type is None:
            model_type = get_sd_model_type(model_abs_path)
        if model_type is None:
            continue

        model_type_cache[it.name] = model_type
        res.append(
            ModelInfo(
                name=it.name,
                path=model_abs_path,
                model_type=model_type,
                is_single_file_diffusers=True,
            )
        )
    if stable_diffusion_dir.exists():
        with open(cache_file, "w", encoding="utf-8") as fw:
            json.dump(model_type_cache, fw, indent=2, ensure_ascii=False)

    stable_diffusion_xl_dir = cache_dir / "stable_diffusion_xl"
    sdxl_cache_file = stable_diffusion_xl_dir / "artie_cache.json"
    sdxl_model_type_cache = {}
    if sdxl_cache_file.exists():
        try:
            with open(sdxl_cache_file, "r", encoding="utf-8") as f:
                sdxl_model_type_cache = json.load(f)
                assert isinstance(sdxl_model_type_cache, dict)
        except:
            pass

    for it in stable_diffusion_xl_dir.glob("*.*"):
        if it.suffix not in [".safetensors", ".ckpt"]:
            continue
        model_abs_path = str(it.absolute())
        model_type = sdxl_model_type_cache.get(it.name)
        if model_type is None:
            model_type = get_sdxl_model_type(model_abs_path)
        if model_type is None:
            continue

        sdxl_model_type_cache[it.name] = model_type
        if stable_diffusion_xl_dir.exists():
            with open(sdxl_cache_file, "w", encoding="utf-8") as fw:
                json.dump(sdxl_model_type_cache, fw, indent=2, ensure_ascii=False)

        res.append(
            ModelInfo(
                name=it.name,
                path=model_abs_path,
                model_type=model_type,
                is_single_file_diffusers=True,
            )
        )
    return res


def scan_inpaint_models(model_dir: Path) -> List[ModelInfo]:
    res = []
    from artie.model import models

    # logger.info(f"Scanning inpaint models in {model_dir}")

    for name, m in models.items():
        if m.is_erase_model and m.is_downloaded():
            res.append(
                ModelInfo(
                    name=name,
                    path=name,
                    model_type=ModelType.INPAINT,
                )
            )
    return res


def scan_diffusers_models() -> List[ModelInfo]:
    from huggingface_hub.constants import HF_HUB_CACHE

    available_models = []
    cache_dir = Path(HF_HUB_CACHE)
    # logger.info(f"Scanning diffusers models in {cache_dir}")
    diffusers_model_names = []
    model_index_files = glob.glob(
        os.path.join(cache_dir, "**/*", "model_index.json"), recursive=True
    )
    for it in model_index_files:
        it = Path(it)
        try:
            with open(it, "r", encoding="utf-8") as f:
                data = json.load(f)
        except:
            continue

        _class_name = data["_class_name"]
        name = folder_name_to_show_name(it.parent.parent.parent.name)
        if name in diffusers_model_names:
            continue
        if "PowerPaint" in name:
            model_type = ModelType.DIFFUSERS_OTHER
        elif _class_name == DIFFUSERS_SD_CLASS_NAME:
            model_type = ModelType.DIFFUSERS_SD
        elif _class_name == DIFFUSERS_SD_INPAINT_CLASS_NAME:
            model_type = ModelType.DIFFUSERS_SD_INPAINT
        elif _class_name == DIFFUSERS_SDXL_CLASS_NAME:
            model_type = ModelType.DIFFUSERS_SDXL
        elif _class_name == DIFFUSERS_SDXL_INPAINT_CLASS_NAME:
            model_type = ModelType.DIFFUSERS_SDXL_INPAINT
        elif _class_name in [
            "StableDiffusionInstructPix2PixPipeline",
            "PaintByExamplePipeline",
            "KandinskyV22InpaintPipeline",
            "AnyText",
        ]:
            model_type = ModelType.DIFFUSERS_OTHER
        else:
            continue

        diffusers_model_names.append(name)
        available_models.append(
            ModelInfo(
                name=name,
                path=name,
                model_type=model_type,
            )
        )
    return available_models


def _scan_converted_diffusers_models(cache_dir) -> List[ModelInfo]:
    cache_dir = Path(cache_dir)
    available_models = []
    diffusers_model_names = []
    model_index_files = glob.glob(
        os.path.join(cache_dir, "**/*", "model_index.json"), recursive=True
    )
    for it in model_index_files:
        it = Path(it)
        with open(it, "r", encoding="utf-8") as f:
            try:
                data = json.load(f)
            except:
                logger.error(
                    f"Failed to load {it}, please try revert from original model or fix model_index.json by hand."
                )
                continue

            _class_name = data["_class_name"]
            name = folder_name_to_show_name(it.parent.name)
            if name in diffusers_model_names:
                continue
            elif _class_name == DIFFUSERS_SD_CLASS_NAME:
                model_type = ModelType.DIFFUSERS_SD
            elif _class_name == DIFFUSERS_SD_INPAINT_CLASS_NAME:
                model_type = ModelType.DIFFUSERS_SD_INPAINT
            elif _class_name == DIFFUSERS_SDXL_CLASS_NAME:
                model_type = ModelType.DIFFUSERS_SDXL
            elif _class_name == DIFFUSERS_SDXL_INPAINT_CLASS_NAME:
                model_type = ModelType.DIFFUSERS_SDXL_INPAINT
            else:
                continue

            diffusers_model_names.append(name)
            available_models.append(
                ModelInfo(
                    name=name,
                    path=str(it.parent.absolute()),
                    model_type=model_type,
                )
            )
    return available_models


def scan_converted_diffusers_models(cache_dir) -> List[ModelInfo]:
    cache_dir = Path(cache_dir)
    available_models = []
    stable_diffusion_dir = cache_dir / "stable_diffusion"
    stable_diffusion_xl_dir = cache_dir / "stable_diffusion_xl"
    available_models.extend(_scan_converted_diffusers_models(stable_diffusion_dir))
    available_models.extend(_scan_converted_diffusers_models(stable_diffusion_xl_dir))
    return available_models


def scan_models() -> List[ModelInfo]:
    model_dir = os.getenv("XDG_CACHE_HOME", DEFAULT_MODEL_DIR)
    available_models = []
    available_models.extend(scan_inpaint_models(model_dir))
    available_models.extend(scan_single_file_diffusion_models(model_dir))
    available_models.extend(scan_diffusers_models())
    available_models.extend(scan_converted_diffusers_models(model_dir))
    return available_models


def ensure_all_models_downloaded():
    """检测并下载所有必需模型，首次运行时自动完成。"""
    from artie.const import REQUIRED_MODELS

    scanned = scan_models()
    scanned_names = {it.name for it in scanned}

    all_ready = all(name in scanned_names for name in REQUIRED_MODELS)
    if all_ready:
        logger.info("所有必需模型已就绪，跳过下载。")
        return

    logger.info("首次初始化：检查并下载缺失的必需模型...")
    for name in REQUIRED_MODELS:
        if name not in scanned_names:
            logger.info(f"  下载模型: {name}")
            try:
                cli_download_model(name)
            except Exception as e:
                if _is_gated_repo_error(e):
                    config_paths = ", ".join(str(p) for p in _hf_token_config_paths())
                    raise RuntimeError(
                        "下载受限模型失败。请先在 HuggingFace 获取该模型访问权限，并在本地配置 token。\n"
                        f"配置文件（任一）: {config_paths}\n"
                        '示例内容: {"hf_token": "hf_xxx"}\n'
                        f"失败模型: {name}"
                    ) from e
                raise
            logger.info(f"  完成: {name}")
        else:
            logger.info(f"  已就绪: {name}")
    logger.info("所有必需模型已准备完毕。")
