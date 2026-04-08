import webbrowser
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import typer
from fastapi import FastAPI
from loguru import logger
from typer import Option
from typer_config import use_json_config

from artie.const import *
from artie.runtime import setup_model_dir, dump_environment_info, check_device
from artie.schema import InteractiveSegModel, Device, RealESRGANModel, RemoveBGModel

typer_app = typer.Typer(pretty_exceptions_show_locals=False, add_completion=False)


@typer_app.command(help="Install all plugins dependencies")
def install_plugins_packages():
    from artie.installer import install_plugins_package

    install_plugins_package()


@typer_app.command(help="Download SD/SDXL normal/inpainting model from HuggingFace")
def download(
    model: str = Option(
        ..., help="Model id on HuggingFace e.g: runwayml/stable-diffusion-inpainting"
    ),
    model_dir: Path = Option(
        DEFAULT_MODEL_DIR,
        help=MODEL_DIR_HELP,
        file_okay=False,
        callback=setup_model_dir,
    ),
):
    from artie.download import cli_download_model

    cli_download_model(model)


@typer_app.command(name="list", help="List downloaded models")
def list_model(
    model_dir: Path = Option(
        DEFAULT_MODEL_DIR,
        help=MODEL_DIR_HELP,
        file_okay=False,
        callback=setup_model_dir,
    ),
):
    from artie.download import scan_models

    scanned_models = scan_models()
    for it in scanned_models:
        print(it.name)


@typer_app.command(help="Batch processing images")
def run(
    model: str = Option("lama"),
    device: Device = Option(Device.cpu),
    image: Path = Option(..., help="Image folders or file path"),
    mask: Path = Option(
        ...,
        help="Mask folders or file path. "
        "If it is a directory, the mask images in the directory should have the same name as the original image."
        "If it is a file, all images will use this mask."
        "Mask will automatically resize to the same size as the original image.",
    ),
    output: Path = Option(..., help="Output directory or file path"),
    config: Path = Option(
        None, help="Config file path. You can use dump command to create a base config."
    ),
    concat: bool = Option(
        False, help="Concat original image, mask and output images into one image"
    ),
    model_dir: Path = Option(
        DEFAULT_MODEL_DIR,
        help=MODEL_DIR_HELP,
        file_okay=False,
        callback=setup_model_dir,
    ),
):
    from artie.download import cli_download_model, scan_models

    scanned_models = scan_models()
    if model not in [it.name for it in scanned_models]:
        logger.info(f"{model} not found in {model_dir}, try to downloading")
        cli_download_model(model)

    from artie.batch_processing import batch_inpaint

    batch_inpaint(model, device, image, mask, output, config, concat)


@typer_app.command(help="Start Artie server")
@use_json_config()
def start(
    host: str = Option("127.0.0.1"),
    port: int = Option(8080),
    inbrowser: bool = Option(False, help=INBROWSER_HELP),
    model_dir: Path = Option(
        DEFAULT_MODEL_DIR,
        help=MODEL_DIR_HELP,
        dir_okay=True,
        file_okay=False,
        callback=setup_model_dir,
    ),
    low_mem: bool = Option(False, help=LOW_MEM_HELP),
    no_half: bool = Option(False, help=NO_HALF_HELP),
    cpu_offload: bool = Option(False, help=CPU_OFFLOAD_HELP),
    disable_nsfw_checker: bool = Option(False, help=DISABLE_NSFW_HELP),
    cpu_textencoder: bool = Option(False, help=CPU_TEXTENCODER_HELP),
    local_files_only: bool = Option(False, help=LOCAL_FILES_ONLY_HELP),
    device: Device = Option(Device.cpu),
    input: Optional[Path] = Option(None, help=INPUT_HELP),
    mask_dir: Optional[Path] = Option(
        None, help=MODEL_DIR_HELP, dir_okay=True, file_okay=False
    ),
    output_dir: Optional[Path] = Option(
        None, help=OUTPUT_DIR_HELP, dir_okay=True, file_okay=False
    ),
    quality: int = Option(100, help=QUALITY_HELP),
    max_cached_models: int = Option(
        3, help="Maximum number of models to keep loaded in the LRU cache. Higher values use more VRAM."
    ),
    max_vram_usage_gb: Optional[float] = Option(
        None,
        help="Maximum GPU VRAM to use in GB (default: 85%% of GPU total). "
        "The LRU cache evicts models to stay below this limit.",
    ),
    disable_auth: bool = Option(
        False,
        help="Disable user authentication. All requests run as an anonymous user (recommended for local single-user use).",
    ),
    auth_secret_key: str = Option(
        "CHANGE_ME_IN_PRODUCTION",
        help="Secret key used to sign JWT tokens. Change this to a long random string in production.",
    ),
    db_path: Optional[Path] = Option(
        None,
        help="Custom SQLite database file path. Defaults to ~/.artie/artie.db",
        dir_okay=False,
    ),
):
    dump_environment_info()
    device = check_device(device)

    if input and not input.exists():
        logger.error(f"invalid --input: {input} not exists")
        exit(-1)
    if mask_dir and not mask_dir.exists():
        logger.error(f"invalid --mask-dir: {mask_dir} not exists")
        exit(-1)
    if input and input.is_dir() and not output_dir:
        logger.error(
            "invalid --output-dir: --output-dir must be set when --input is a directory"
        )
        exit(-1)
    if output_dir:
        output_dir = output_dir.expanduser().absolute()
        logger.info(f"Image will be saved to {output_dir}")
        if not output_dir.exists():
            logger.info(f"Create output directory {output_dir}")
            output_dir.mkdir(parents=True)
    if mask_dir:
        mask_dir = mask_dir.expanduser().absolute()

    model_dir = model_dir.expanduser().absolute()

    if local_files_only:
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["HF_HUB_OFFLINE"] = "1"
    else:
        from artie.download import ensure_all_models_downloaded
        ensure_all_models_downloaded()

    from artie.api import Api
    from artie.schema import ApiConfig

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if inbrowser:
            webbrowser.open(f"http://localhost:{port}", new=0, autoraise=True)
        yield

    app = FastAPI(lifespan=lifespan)

    # 所有插件自动启用，设备跟随主 device
    plugin_device = device
    api_config = ApiConfig(
        host=host,
        port=port,
        inbrowser=inbrowser,
        model=DEFAULT_MODEL,
        no_half=no_half,
        low_mem=low_mem,
        cpu_offload=cpu_offload,
        disable_nsfw_checker=disable_nsfw_checker,
        local_files_only=local_files_only,
        cpu_textencoder=cpu_textencoder if device == Device.cuda else False,
        device=device,
        input=input,
        mask_dir=mask_dir,
        output_dir=output_dir,
        quality=quality,
        enable_interactive_seg=True,
        interactive_seg_model=InteractiveSegModel.sam2_1_tiny,
        interactive_seg_device=plugin_device,
        enable_remove_bg=True,
        remove_bg_device=plugin_device,
        remove_bg_model=RemoveBGModel.briaai_rmbg_1_4,
        enable_anime_seg=False,
        enable_realesrgan=True,
        realesrgan_device=plugin_device,
        realesrgan_model=RealESRGANModel.realesr_general_x4v3,
        enable_gfpgan=True,
        gfpgan_device=plugin_device,
        enable_restoreformer=False,
        restoreformer_device=plugin_device,
        max_cached_models=max_cached_models,
        max_vram_usage_gb=max_vram_usage_gb,
        disable_auth=disable_auth,
        auth_secret_key=auth_secret_key,
        db_path=db_path,
    )
    print(api_config.model_dump_json(indent=4))
    api = Api(app, api_config)
    api.launch()


@typer_app.command(help="Start Artie web config page")
def start_web_config(
    config_file: Path = Option("config.json"),
):
    dump_environment_info()
    from artie.web_config import main

    main(config_file)
