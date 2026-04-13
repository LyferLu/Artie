from typing import Dict

from loguru import logger

from .anime_seg import AnimeSeg
from .gfpgan_plugin import GFPGANPlugin
from .interactive_seg import InteractiveSeg
from .realesrgan import RealESRGANUpscaler
from .remove_bg import RemoveBG
from .restoreformer import RestoreFormerPlugin
from ..schema import InteractiveSegModel, Device, RealESRGANModel


def build_plugins(
    enable_interactive_seg: bool,
    interactive_seg_model: InteractiveSegModel,
    interactive_seg_device: Device,
    enable_remove_bg: bool,
    remove_bg_device: Device,
    remove_bg_model: str,
    enable_anime_seg: bool,
    enable_realesrgan: bool,
    realesrgan_device: Device,
    realesrgan_model: RealESRGANModel,
    enable_gfpgan: bool,
    gfpgan_device: Device,
    enable_restoreformer: bool,
    restoreformer_device: Device,
    no_half: bool,
    local_files_only: bool = False,
) -> Dict:
    plugins = {}

    def try_init(name: str, factory):
        try:
            plugins[name] = factory()
        except Exception as e:
            logger.warning(f"Skip plugin {name}: {e}")

    if enable_interactive_seg:
        logger.info(f"Initialize {InteractiveSeg.name} plugin")
        try_init(
            InteractiveSeg.name,
            lambda: InteractiveSeg(interactive_seg_model, interactive_seg_device),
        )

    if enable_remove_bg:
        logger.info(f"Initialize {RemoveBG.name} plugin")
        try_init(
            RemoveBG.name,
            lambda: RemoveBG(
                remove_bg_model,
                remove_bg_device,
                local_files_only=local_files_only,
            ),
        )

    if enable_anime_seg:
        logger.info(f"Initialize {AnimeSeg.name} plugin")
        try_init(AnimeSeg.name, lambda: AnimeSeg())

    if enable_realesrgan:
        logger.info(
            f"Initialize {RealESRGANUpscaler.name} plugin: {realesrgan_model}, {realesrgan_device}"
        )
        try_init(
            RealESRGANUpscaler.name,
            lambda: RealESRGANUpscaler(
                realesrgan_model,
                realesrgan_device,
                no_half=no_half,
            ),
        )
        

    if enable_gfpgan:
        logger.info(f"Initialize {GFPGANPlugin.name} plugin")
        if enable_realesrgan:
            logger.info("Use realesrgan as GFPGAN background upscaler")
        else:
            logger.info(
                f"GFPGAN no background upscaler, use --enable-realesrgan to enable it"
            )
        try_init(
            GFPGANPlugin.name,
            lambda: GFPGANPlugin(
                gfpgan_device,
                upscaler=plugins.get(RealESRGANUpscaler.name, None),
            ),
        )

    if enable_restoreformer:
        logger.info(f"Initialize {RestoreFormerPlugin.name} plugin")
        try_init(
            RestoreFormerPlugin.name,
            lambda: RestoreFormerPlugin(
                restoreformer_device,
                upscaler=plugins.get(RealESRGANUpscaler.name, None),
            ),
        )
    return plugins
