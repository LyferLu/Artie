import gc
from collections import OrderedDict
from typing import List, Dict, Optional

import torch
from loguru import logger
import numpy as np

from artie.download import scan_models
from artie.helper import switch_mps_device
from artie.model import models, ControlNet, SD, SDXL, SDXLBase
from artie.model.brushnet.brushnet_wrapper import BrushNetWrapper
from artie.model.brushnet.brushnet_xl_wrapper import BrushNetXLWrapper
from artie.model.power_paint.power_paint_v2 import PowerPaintV2
from artie.model.utils import torch_gc, is_local_files_only
from artie.schema import InpaintRequest, ModelInfo, ModelType, Txt2ImgRequest


class ModelCache:
    """LRU cache for loaded inpaint models with VRAM tracking."""

    def __init__(
        self,
        device: torch.device,
        max_models: int = 3,
        max_vram_gb: Optional[float] = None,
    ):
        self.device = device
        self.max_models = max(1, max_models)
        self.max_vram_gb = max_vram_gb or self._detect_vram_limit()
        # OrderedDict: most-recently-used at the end (last)
        self._cache: OrderedDict = OrderedDict()
        # Measured VRAM consumption per cached model key
        self._model_vram_gb: Dict[str, float] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get(self, key: str):
        """Return cached model and mark it as recently used, or None on miss."""
        if key in self._cache:
            self._cache.move_to_end(key)
            logger.info(f"ModelCache hit: {key}")
            return self._cache[key]
        return None

    def put(self, key: str, model, vram_gb: float):
        """Insert or update a model in the cache, evicting LRU entries as needed."""
        if key in self._cache:
            self._cache.move_to_end(key)
            self._cache[key] = model
            self._model_vram_gb[key] = vram_gb
            return

        self._evict_if_needed(vram_gb)
        self._cache[key] = model
        self._model_vram_gb[key] = vram_gb
        logger.info(
            f"ModelCache stored: {key} ({vram_gb:.2f} GB). "
            f"Cache size: {len(self._cache)}/{self.max_models}"
        )

    def remove(self, key: str):
        """Explicitly remove a model from the cache."""
        if key in self._cache:
            del self._cache[key]
            self._model_vram_gb.pop(key, None)
            torch_gc()

    def cached_keys(self) -> List[str]:
        return list(self._cache.keys())

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _evict_if_needed(self, needed_gb: float):
        """Evict LRU models until we have room for `needed_gb` of new content."""
        while self._cache and (
            len(self._cache) >= self.max_models
            or self._current_allocated_gb() + needed_gb > self.max_vram_gb
        ):
            evicted_key, evicted_model = self._cache.popitem(last=False)
            evicted_vram = self._model_vram_gb.pop(evicted_key, 0.0)
            del evicted_model
            gc.collect()
            torch_gc()
            logger.info(
                f"ModelCache evicted LRU: {evicted_key} ({evicted_vram:.2f} GB freed)"
            )

    def _current_allocated_gb(self) -> float:
        if torch.cuda.is_available():
            return torch.cuda.memory_allocated() / (1024 ** 3)
        # Fallback: sum of recorded estimates
        return sum(self._model_vram_gb.values())

    def _detect_vram_limit(self) -> float:
        """Return 85% of total GPU VRAM, or a conservative 8 GB on CPU/MPS."""
        if torch.cuda.is_available():
            total_bytes = torch.cuda.get_device_properties(0).total_memory
            return (total_bytes / (1024 ** 3)) * 0.85
        return 8.0


class ModelManager:
    def __init__(self, name: str, device: torch.device, **kwargs):
        self.name = name
        self.device = device
        self.kwargs = kwargs
        self.available_models: Dict[str, ModelInfo] = {}
        self.scan_models()

        self.enable_controlnet = kwargs.get("enable_controlnet", False)
        controlnet_method = kwargs.get("controlnet_method", None)
        if (
            controlnet_method is None
            and name in self.available_models
            and self.available_models[name].support_controlnet
        ):
            controlnet_method = self.available_models[name].controlnets[0]
        self.controlnet_method = controlnet_method

        self.enable_brushnet = kwargs.get("enable_brushnet", False)
        self.brushnet_method = kwargs.get("brushnet_method", None)

        self.enable_powerpaint_v2 = kwargs.get("enable_powerpaint_v2", False)

        # LRU cache for loaded models
        self._cache = ModelCache(
            device=device,
            max_models=kwargs.get("max_cached_models", 3),
            max_vram_gb=kwargs.get("max_vram_usage_gb", None),
        )

        self.active_variant = "default"
        self.model = self._load_and_cache(name, device, variant="default", **kwargs)

    @property
    def current_model(self) -> ModelInfo:
        return self.available_models[self.name]

    def cached_model_names(self) -> List[str]:
        return self._cache.cached_keys()

    def _cache_key(self, name: str, variant: str = "default") -> str:
        """Build a cache key that encodes the model name plus active wrappers."""
        suffix = ""
        if self.enable_controlnet and self.controlnet_method:
            suffix += f"+controlnet_{self.controlnet_method.split('/')[-1]}"
        if self.enable_brushnet and self.brushnet_method:
            suffix += f"+brushnet_{self.brushnet_method}"
        if self.enable_powerpaint_v2:
            suffix += "+powerpaint_v2"
        if variant != "default":
            suffix += f"+variant_{variant}"
        return f"{name}{suffix}"

    def _load_and_cache(self, name: str, device, variant: str = "default", **kwargs):
        """Return model from cache if available, otherwise load and cache it."""
        key = self._cache_key(name, variant)
        cached = self._cache.get(key)
        if cached is not None:
            return cached

        # Measure VRAM before and after loading
        vram_before = (
            torch.cuda.memory_allocated() / (1024 ** 3)
            if torch.cuda.is_available()
            else 0.0
        )
        model = self.init_model(name, device, variant=variant, **kwargs)
        vram_after = (
            torch.cuda.memory_allocated() / (1024 ** 3)
            if torch.cuda.is_available()
            else 0.0
        )
        vram_used = max(0.0, vram_after - vram_before)
        self._cache.put(key, model, vram_used)
        return model

    def init_model(self, name: str, device, variant: str = "default", **kwargs):
        logger.info(f"Loading model: {name}")
        if name not in self.available_models:
            raise NotImplementedError(
                f"Unsupported model: {name}. Available models: {list(self.available_models.keys())}"
            )

        model_info = self.available_models[name]
        kwargs = {
            **kwargs,
            "model_info": model_info,
            "enable_controlnet": self.enable_controlnet,
            "controlnet_method": self.controlnet_method,
            "enable_brushnet": self.enable_brushnet,
            "brushnet_method": self.brushnet_method,
        }

        if model_info.support_controlnet and self.enable_controlnet:
            return ControlNet(device, **kwargs)

        if model_info.support_brushnet and self.enable_brushnet:
            if model_info.model_type == ModelType.DIFFUSERS_SD:
                return BrushNetWrapper(device, **kwargs)
            elif model_info.model_type == ModelType.DIFFUSERS_SDXL:
                return BrushNetXLWrapper(device, **kwargs)

        if model_info.support_powerpaint_v2 and self.enable_powerpaint_v2:
            return PowerPaintV2(device, **kwargs)

        if model_info.name in models:
            return models[name](device, **kwargs)

        if model_info.model_type in [
            ModelType.DIFFUSERS_SD_INPAINT,
            ModelType.DIFFUSERS_SD,
        ]:
            return SD(device, **kwargs)

        if model_info.model_type == ModelType.DIFFUSERS_SDXL_INPAINT:
            return SDXL(device, **kwargs)

        if model_info.model_type == ModelType.DIFFUSERS_SDXL:
            if variant == "inpaint_compat":
                return SDXL(device, **kwargs)
            return SDXLBase(device, **kwargs)

        raise NotImplementedError(f"Unsupported model: {name}")

    def _ensure_variant(self, variant: str):
        if self.active_variant == variant:
            return
        self.model = self._load_and_cache(
            self.name,
            switch_mps_device(self.name, self.device),
            variant=variant,
            **self.kwargs,
        )
        self.active_variant = variant

    @torch.inference_mode()
    def txt2img(self, config: Txt2ImgRequest):
        if not self.current_model.support_txt2img:
            raise NotImplementedError(
                f"Model {self.name} does not support text-to-image generation"
            )
        self._ensure_variant("default")
        self.enable_disable_lcm_lora(config)
        result = self.model.txt2img(config)
        torch_gc()
        return result

    @torch.inference_mode()
    def __call__(self, image, mask, config: InpaintRequest):
        """

        Args:
            image: [H, W, C] RGB
            mask: [H, W, 1] 255 means area to repaint
            config:

        Returns:
            BGR image
        """
        if (
            config.task_type == "repaint"
            and self.current_model.model_type == ModelType.DIFFUSERS_SDXL
        ):
            self._ensure_variant("inpaint_compat")
        elif (
            self.current_model.model_type == ModelType.DIFFUSERS_SDXL
            and self.active_variant != "default"
        ):
            self._ensure_variant("default")

        if config.enable_controlnet:
            self.switch_controlnet_method(config)
        if config.enable_brushnet:
            self.switch_brushnet_method(config)

        self.enable_disable_powerpaint_v2(config)
        self.enable_disable_lcm_lora(config)
        return self.model(image, mask, config).astype(np.uint8)

    def scan_models(self) -> List[ModelInfo]:
        available_models = scan_models()
        self.available_models = {it.name: it for it in available_models}
        return available_models

    def switch(self, new_name: str, variant: str = "default"):
        if new_name == self.name:
            self._ensure_variant(variant)
            return

        old_name = self.name
        old_variant = self.active_variant
        old_controlnet_method = self.controlnet_method
        new_controlnet_method = self.controlnet_method
        if self.available_models[new_name].support_controlnet and (
            new_controlnet_method
            not in self.available_models[new_name].controlnets
        ):
            new_controlnet_method = self.available_models[new_name].controlnets[0]
        try:
            # Use LRU cache: old model stays cached, new model loaded on miss
            new_model = self._load_and_cache(
                new_name,
                switch_mps_device(new_name, self.device),
                variant=variant,
                **self.kwargs,
            )
            # Keep name/model/controlnet_method consistent in one shot.
            self.name = new_name
            self.controlnet_method = new_controlnet_method
            self.model = new_model
            self.active_variant = variant
        except Exception as e:
            self.name = old_name
            self.active_variant = old_variant
            self.controlnet_method = old_controlnet_method
            logger.info(f"Switch model from {old_name} to {new_name} failed, rollback")
            # Rollback: retrieve from cache (was the active model before switch)
            self.model = self._load_and_cache(
                old_name,
                switch_mps_device(old_name, self.device),
                variant=old_variant,
                **self.kwargs,
            )
            raise e

    def switch_brushnet_method(self, config):
        if not self.available_models[self.name].support_brushnet:
            return

        if (
            self.enable_brushnet
            and config.brushnet_method
            and self.brushnet_method != config.brushnet_method
        ):
            old_brushnet_method = self.brushnet_method
            self.brushnet_method = config.brushnet_method
            self.model.switch_brushnet_method(config.brushnet_method)
            logger.info(
                f"Switch Brushnet method from {old_brushnet_method} to {config.brushnet_method}"
            )

        elif self.enable_brushnet != config.enable_brushnet:
            self.enable_brushnet = config.enable_brushnet
            self.brushnet_method = config.brushnet_method

            pipe_components = {
                "vae": self.model.model.vae,
                "text_encoder": self.model.model.text_encoder,
                "unet": self.model.model.unet,
            }
            if hasattr(self.model.model, "text_encoder_2"):
                pipe_components["text_encoder_2"] = self.model.model.text_encoder_2
            if hasattr(self.model.model, "tokenizer"):
                pipe_components["tokenizer"] = self.model.model.tokenizer
            if hasattr(self.model.model, "tokenizer_2"):
                pipe_components["tokenizer_2"] = self.model.model.tokenizer_2

            # Invalidate old cache entry and reload with new wrapper config
            old_key = self._cache_key(self.name)
            self._cache.remove(old_key)
            self.model = self._load_and_cache(
                self.name,
                switch_mps_device(self.name, self.device),
                pipe_components=pipe_components,
                **self.kwargs,
            )

            if not config.enable_brushnet:
                logger.info("BrushNet Disabled")
            else:
                logger.info("BrushNet Enabled")

    def switch_controlnet_method(self, config):
        if not self.available_models[self.name].support_controlnet:
            return

        if (
            self.enable_controlnet
            and config.controlnet_method
            and self.controlnet_method != config.controlnet_method
        ):
            old_controlnet_method = self.controlnet_method
            self.controlnet_method = config.controlnet_method
            self.model.switch_controlnet_method(config.controlnet_method)
            logger.info(
                f"Switch Controlnet method from {old_controlnet_method} to {config.controlnet_method}"
            )
        elif self.enable_controlnet != config.enable_controlnet:
            self.enable_controlnet = config.enable_controlnet
            self.controlnet_method = config.controlnet_method

            pipe_components = {
                "vae": self.model.model.vae,
                "text_encoder": self.model.model.text_encoder,
                "unet": self.model.model.unet,
            }
            if hasattr(self.model.model, "text_encoder_2"):
                pipe_components["text_encoder_2"] = self.model.model.text_encoder_2

            # Invalidate old cache entry and reload with new wrapper config
            old_key = self._cache_key(self.name)
            self._cache.remove(old_key)
            self.model = self._load_and_cache(
                self.name,
                switch_mps_device(self.name, self.device),
                pipe_components=pipe_components,
                **self.kwargs,
            )
            if not config.enable_controlnet:
                logger.info("Disable controlnet")
            else:
                logger.info(f"Enable controlnet: {config.controlnet_method}")

    def enable_disable_powerpaint_v2(self, config: InpaintRequest):
        if not self.available_models[self.name].support_powerpaint_v2:
            return

        if self.enable_powerpaint_v2 != config.enable_powerpaint_v2:
            self.enable_powerpaint_v2 = config.enable_powerpaint_v2
            pipe_components = {"vae": self.model.model.vae}

            old_key = self._cache_key(self.name)
            self._cache.remove(old_key)
            self.model = self._load_and_cache(
                self.name,
                switch_mps_device(self.name, self.device),
                pipe_components=pipe_components,
                **self.kwargs,
            )
            if config.enable_powerpaint_v2:
                logger.info("Enable PowerPaintV2")
            else:
                logger.info("Disable PowerPaintV2")

    def enable_disable_lcm_lora(self, config):
        if self.available_models[self.name].support_lcm_lora:
            if not hasattr(self.model, "model"):
                return
            # Some non-diffusers backends (or transient states during switch) do not
            # expose PEFT adapter APIs.
            if not hasattr(self.model.model, "get_list_adapters"):
                logger.warning(
                    f"Current backend does not support LoRA adapters, skip LCM toggle: {type(self.model.model).__name__}"
                )
                return
            # TODO: change this if load other lora is supported
            lcm_lora_loaded = bool(self.model.model.get_list_adapters())
            if config.sd_lcm_lora:
                if not lcm_lora_loaded:
                    logger.info("Load LCM LORA")
                    self.model.model.load_lora_weights(
                        self.model.lcm_lora_id,
                        weight_name="pytorch_lora_weights.safetensors",
                        local_files_only=is_local_files_only(),
                    )
                else:
                    logger.info("Enable LCM LORA")
                    self.model.model.enable_lora()
            else:
                if lcm_lora_loaded:
                    logger.info("Disable LCM LORA")
                    self.model.model.disable_lora()
