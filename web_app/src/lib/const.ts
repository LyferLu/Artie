export const ACCENT_COLOR = "#ffcc00bb"
export const DEFAULT_BRUSH_SIZE = 40
export const MIN_BRUSH_SIZE = 1
export const MAX_BRUSH_SIZE = 200
export const MODEL_TYPE_INPAINT = "inpaint"
export const MODEL_TYPE_DIFFUSERS_SD = "diffusers_sd"
export const MODEL_TYPE_DIFFUSERS_SDXL = "diffusers_sdxl"
export const MODEL_TYPE_DIFFUSERS_SD_INPAINT = "diffusers_sd_inpaint"
export const MODEL_TYPE_DIFFUSERS_SDXL_INPAINT = "diffusers_sdxl_inpaint"
export const MODEL_TYPE_OTHER = "diffusers_other"
export const BRUSH_COLOR = "#ffcc00bb"

export const LDM = "ldm"
export const CV2 = "cv2"

export const PAINT_BY_EXAMPLE = "Fantasy-Studio/Paint-by-Example"
export const INSTRUCT_PIX2PIX = "timbrooks/instruct-pix2pix"
export const KANDINSKY_2_2 = "kandinsky-community/kandinsky-2-2-decoder-inpaint"
export const POWERPAINT = "Sanster/PowerPaint-V1-stable-diffusion-inpainting"
export const ANYTEXT = "Sanster/AnyText"
export const OUTPAINT_MODEL = POWERPAINT
export const AI_REPAINT_MODEL = POWERPAINT
export const TXT2IMG_JUGGERNAUT_MODEL = "RunDiffusion/Juggernaut-XI-v11"

export const DEFAULT_NEGATIVE_PROMPT =
  "out of frame, lowres, error, cropped, worst quality, low quality, jpeg artifacts, ugly, duplicate, morbid, mutilated, out of frame, mutation, deformed, blurry, dehydrated, bad anatomy, bad proportions, extra limbs, disfigured, gross proportions, malformed limbs, watermark, signature"

export interface ResolutionPreset {
  label: string
  width: number
  height: number
  modelTypes: string[]
}

export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  {
    label: "512 × 512",
    width: 512,
    height: 512,
    modelTypes: [
      MODEL_TYPE_DIFFUSERS_SD,
      MODEL_TYPE_DIFFUSERS_SD_INPAINT,
      MODEL_TYPE_DIFFUSERS_SDXL,
      MODEL_TYPE_DIFFUSERS_SDXL_INPAINT,
    ],
  },
  {
    label: "768 × 768",
    width: 768,
    height: 768,
    modelTypes: [
      MODEL_TYPE_DIFFUSERS_SD,
      MODEL_TYPE_DIFFUSERS_SD_INPAINT,
      MODEL_TYPE_DIFFUSERS_SDXL,
      MODEL_TYPE_DIFFUSERS_SDXL_INPAINT,
    ],
  },
  {
    label: "768 × 512",
    width: 768,
    height: 512,
    modelTypes: [MODEL_TYPE_DIFFUSERS_SD, MODEL_TYPE_DIFFUSERS_SD_INPAINT],
  },
  {
    label: "512 × 768",
    width: 512,
    height: 768,
    modelTypes: [MODEL_TYPE_DIFFUSERS_SD, MODEL_TYPE_DIFFUSERS_SD_INPAINT],
  },
  {
    label: "1024 × 1024 (SDXL 推荐)",
    width: 1024,
    height: 1024,
    modelTypes: [MODEL_TYPE_DIFFUSERS_SDXL, MODEL_TYPE_DIFFUSERS_SDXL_INPAINT],
  },
  {
    label: "1152 × 896",
    width: 1152,
    height: 896,
    modelTypes: [MODEL_TYPE_DIFFUSERS_SDXL, MODEL_TYPE_DIFFUSERS_SDXL_INPAINT],
  },
  {
    label: "896 × 1152",
    width: 896,
    height: 1152,
    modelTypes: [MODEL_TYPE_DIFFUSERS_SDXL, MODEL_TYPE_DIFFUSERS_SDXL_INPAINT],
  },
  {
    label: "1216 × 832",
    width: 1216,
    height: 832,
    modelTypes: [MODEL_TYPE_DIFFUSERS_SDXL, MODEL_TYPE_DIFFUSERS_SDXL_INPAINT],
  },
  {
    label: "832 × 1216",
    width: 832,
    height: 1216,
    modelTypes: [MODEL_TYPE_DIFFUSERS_SDXL, MODEL_TYPE_DIFFUSERS_SDXL_INPAINT],
  },
]

export interface RecommendedModel {
  name: string
  label: string
  description: string
  vramGb: number
  type: string
}

export const RECOMMENDED_MODELS: RecommendedModel[] = [
  {
    name: "stabilityai/stable-diffusion-xl-base-1.0",
    label: "SDXL Base 1.0",
    description: "官方基线，稳定可靠，适合作为起点",
    vramGb: 6.5,
    type: MODEL_TYPE_DIFFUSERS_SDXL,
  },
  {
    name: TXT2IMG_JUGGERNAUT_MODEL,
    label: "Juggernaut XI",
    description: "照片级写实，高细节，人像/场景效果极佳",
    vramGb: 6.5,
    type: MODEL_TYPE_DIFFUSERS_SDXL,
  },
  {
    name: "SG161222/RealVisXL_V5.0",
    label: "RealVisXL V5",
    description: "写实风格，擅长人物，肤色自然",
    vramGb: 6.5,
    type: MODEL_TYPE_DIFFUSERS_SDXL,
  },
  {
    name: "Lykon/dreamshaper-xl-v2-turbo",
    label: "DreamShaper XL Turbo",
    description: "快速生成（约8步），艺术与写实兼顾",
    vramGb: 6.5,
    type: MODEL_TYPE_DIFFUSERS_SDXL,
  },
]

export const SHORTCUT_KEY_CHANGE_BRUSH_SIZE = "Alt"
