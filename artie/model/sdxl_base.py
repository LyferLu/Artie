import cv2
import torch
from diffusers import AutoencoderKL
from loguru import logger

from artie.schema import InpaintRequest, Txt2ImgRequest

from .base import DiffusionInpaintModel
from .helper.cpu_text_encoder import CPUTextEncoderWrapper
from .utils import (
    handle_from_pretrained_exceptions,
    get_torch_dtype,
    enable_low_mem,
    is_local_files_only,
)


class SDXLBase(DiffusionInpaintModel):
    """SDXL base model for text-to-image generation.
    Uses StableDiffusionXLPipeline (4-channel UNet) — not an inpaint model.
    """

    name = "stabilityai/stable-diffusion-xl-base-1.0"
    pad_mod = 8
    min_size = 512
    lcm_lora_id = "latent-consistency/lcm-lora-sdxl"

    def init_model(self, device: torch.device, **kwargs):
        from diffusers import StableDiffusionXLPipeline

        use_gpu, torch_dtype = get_torch_dtype(device, kwargs.get("no_half", False))

        model_kwargs = {
            **kwargs.get("pipe_components", {}),
            "local_files_only": is_local_files_only(**kwargs),
        }
        if "vae" not in model_kwargs:
            vae = AutoencoderKL.from_pretrained(
                "madebyollin/sdxl-vae-fp16-fix", torch_dtype=torch_dtype,
                local_files_only=is_local_files_only(**kwargs),
            )
            model_kwargs["vae"] = vae

        self.model = handle_from_pretrained_exceptions(
            StableDiffusionXLPipeline.from_pretrained,
            pretrained_model_name_or_path=self.model_id_or_path,
            torch_dtype=torch_dtype,
            variant="fp16",
            **model_kwargs,
        )

        enable_low_mem(self.model, kwargs.get("low_mem", False))

        if kwargs.get("cpu_offload", False) and use_gpu:
            logger.info("Enable sequential cpu offload")
            self.model.enable_sequential_cpu_offload(gpu_id=0)
        else:
            self.model = self.model.to(device)
            if kwargs.get("sd_cpu_textencoder", False):
                logger.info("Run Stable Diffusion TextEncoder on CPU")
                self.model.text_encoder = CPUTextEncoderWrapper(
                    self.model.text_encoder, torch_dtype
                )
                self.model.text_encoder_2 = CPUTextEncoderWrapper(
                    self.model.text_encoder_2, torch_dtype
                )

        self.callback = kwargs.pop("callback", None)

    def txt2img(self, config: Txt2ImgRequest):
        """Native txt2img using StableDiffusionXLPipeline (4-channel UNet).
        Returns BGR image as numpy array [H, W, C].
        """
        self.set_scheduler(config)

        output = self.model(
            prompt=config.prompt,
            negative_prompt=config.negative_prompt if config.negative_prompt else None,
            num_inference_steps=config.sd_steps,
            guidance_scale=config.sd_guidance_scale,
            height=config.height,
            width=config.width,
            generator=torch.Generator(device=self.model.device).manual_seed(config.sd_seed),
            callback_on_step_end=self.callback,
            output_type="np",
        ).images[0]

        output = (output * 255).round().astype("uint8")
        output = cv2.cvtColor(output, cv2.COLOR_RGB2BGR)
        return output

    def forward(self, image, mask, config: InpaintRequest):
        raise NotImplementedError(
            f"{self.name} is a text-to-image model and does not support inpainting. "
            "Switch to an inpaint model for this operation."
        )
