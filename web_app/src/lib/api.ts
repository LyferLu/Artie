import {
  Filename,
  GenInfo,
  ImageInfo,
  ModelInfo,
  PowerPaintTask,
  ProjectInfo,
  Rect,
  ServerConfig,
  UserInfo,
} from "@/lib/types"
import { Settings } from "@/lib/states"
import { convertToBase64, srcToFile } from "@/lib/utils"
import axios from "axios"

export const API_ENDPOINT = import.meta.env.DEV
  ? import.meta.env.VITE_BACKEND + "/api/v1"
  : "/api/v1"

let _authToken: string | null = null

export function setAuthToken(token: string | null) {
  _authToken = token
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`
  } else {
    delete api.defaults.headers.common["Authorization"]
  }
}

export function getAuthToken(): string | null {
  return _authToken
}

const api = axios.create({
  baseURL: API_ENDPOINT,
})

const throwErrors = async (res: any): Promise<never> => {
  const errMsg = await res.json().catch(() => ({}))
  const detail = errMsg.errors || errMsg.detail || `HTTP ${res.status}`
  if (res.status === 409) {
    throw new Error(detail)
  }
  throw new Error(
    `${detail}\nPlease take a screenshot of the detailed error message in your terminal`
  )
}

export default async function inpaint(
  imageFile: File,
  settings: Settings,
  croperRect: Rect,
  extenderState: Rect,
  mask: File | Blob,
  paintByExampleImage: File | null = null
) {
  const imageBase64 = await convertToBase64(imageFile)
  const maskBase64 = await convertToBase64(mask)
  const exampleImageBase64 = paintByExampleImage
    ? await convertToBase64(paintByExampleImage)
    : null

  const res = await fetch(`${API_ENDPOINT}/inpaint`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image: imageBase64,
      mask: maskBase64,
      ldm_steps: settings.ldmSteps,
      ldm_sampler: settings.ldmSampler,
      zits_wireframe: settings.zitsWireframe,
      cv2_flag: settings.cv2Flag,
      cv2_radius: settings.cv2Radius,
      hd_strategy: "Crop",
      hd_strategy_crop_triger_size: 640,
      hd_strategy_crop_margin: 128,
      hd_trategy_resize_imit: 2048,
      prompt: settings.prompt,
      negative_prompt: settings.negativePrompt,
      use_croper: settings.showCropper,
      croper_x: croperRect.x,
      croper_y: croperRect.y,
      croper_height: croperRect.height,
      croper_width: croperRect.width,
      use_extender: settings.showExtender,
      task_type: settings.showExtender ? "outpaint" : "inpaint",
      extender_x: extenderState.x,
      extender_y: extenderState.y,
      extender_height: extenderState.height,
      extender_width: extenderState.width,
      sd_mask_blur: settings.sdMaskBlur,
      sd_strength: settings.sdStrength,
      sd_steps: settings.sdSteps,
      sd_guidance_scale: settings.sdGuidanceScale,
      sd_sampler: settings.sdSampler,
      sd_seed: settings.seedFixed ? settings.seed : -1,
      sd_match_histograms: settings.sdMatchHistograms,
      sd_lcm_lora: settings.enableLCMLora,
      paint_by_example_example_image: exampleImageBase64,
      p2p_image_guidance_scale: settings.p2pImageGuidanceScale,
      enable_controlnet: settings.enableControlnet,
      controlnet_conditioning_scale: settings.controlnetConditioningScale,
      controlnet_method: settings.controlnetMethod
        ? settings.controlnetMethod
        : "",
      enable_brushnet: settings.enableBrushNet,
      brushnet_method: settings.brushnetMethod ? settings.brushnetMethod : "",
      brushnet_conditioning_scale: settings.brushnetConditioningScale,
      enable_powerpaint_v2: settings.enablePowerPaintV2,
      powerpaint_task: settings.showExtender
        ? PowerPaintTask.outpainting
        : settings.powerpaintTask,
    }),
  })
  if (res.ok) {
    const blob = await res.blob()
    return {
      blob: URL.createObjectURL(blob),
      seed: res.headers.get("X-Seed"),
    }
  }
  throw await throwErrors(res)
}

export async function getServerConfig(): Promise<ServerConfig> {
  const res = await api.get(`/server-config`)
  return res.data
}

export async function switchModel(name: string): Promise<ModelInfo> {
  const res = await api.post(`/model`, { name })
  return res.data
}

export async function switchPluginModel(
  plugin_name: string,
  model_name: string
) {
  return api.post(`/switch_plugin_model`, { plugin_name, model_name })
}

export async function currentModel(): Promise<ModelInfo> {
  const res = await api.get("/model")
  return res.data
}

export async function runPlugin(
  genMask: boolean,
  name: string,
  imageFile: File,
  upscale?: number,
  clicks?: number[][]
) {
  const imageBase64 = await convertToBase64(imageFile)
  const p = genMask ? "run_plugin_gen_mask" : "run_plugin_gen_image"
  const res = await fetch(`${API_ENDPOINT}/${p}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      image: imageBase64,
      scale: upscale,
      clicks,
    }),
  })
  if (res.ok) {
    const blob = await res.blob()
    return { blob: URL.createObjectURL(blob) }
  }
  throw await throwErrors(res)
}

export async function getMediaFile(tab: string, filename: string) {
  const res = await fetch(
    `${API_ENDPOINT}/media_file?tab=${tab}&filename=${encodeURIComponent(
      filename
    )}`,
    {
      method: "GET",
    }
  )
  if (res.ok) {
    const blob = await res.blob()
    const file = new File([blob], filename, {
      type: res.headers.get("Content-Type") ?? "image/png",
    })
    return file
  }
  throw await throwErrors(res)
}

export async function getMediaBlob(tab: string, filename: string) {
  const res = await fetch(
    `${API_ENDPOINT}/media_file?tab=${tab}&filename=${encodeURIComponent(
      filename
    )}`,
    {
      method: "GET",
    }
  )
  if (res.ok) {
    const blob = await res.blob()
    return blob
  }
  throw await throwErrors(res)
}

export async function getMedias(tab: string): Promise<Filename[]> {
  const res = await api.get(`medias`, { params: { tab } })
  return res.data
}

export async function downloadToOutput(
  image: HTMLImageElement,
  filename: string,
  mimeType: string
) {
  const file = await srcToFile(image.src, filename, mimeType)
  const fd = new FormData()
  fd.append("file", file)

  try {
    const res = await fetch(`${API_ENDPOINT}/save_image`, {
      method: "POST",
      body: fd,
    })
    if (!res.ok) {
      throw await throwErrors(res)
    }
  } catch (error) {
    throw new Error(`Something went wrong: ${error}`)
  }
}

export async function getGenInfo(file: File): Promise<GenInfo> {
  const fd = new FormData()
  fd.append("file", file)
  const res = await api.post(`/gen-info`, fd)
  return res.data
}

export async function getSamplers(): Promise<string[]> {
  const res = await api.post("/samplers")
  return res.data
}

export interface Txt2ImgParams {
  prompt: string
  negativePrompt: string
  modelName?: string
  width: number
  height: number
  steps: number
  guidanceScale: number
  sampler: string
  seed: number
  seedFixed: boolean
  enableLCMLora: boolean
}

export async function txt2img(params: Txt2ImgParams) {
  const res = await fetch(`${API_ENDPOINT}/txt2img`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: params.prompt,
      negative_prompt: params.negativePrompt,
      model_name: params.modelName,
      width: params.width,
      height: params.height,
      sd_steps: params.steps,
      sd_guidance_scale: params.guidanceScale,
      sd_sampler: params.sampler,
      sd_seed: params.seedFixed ? params.seed : -1,
      sd_lcm_lora: params.enableLCMLora,
    }),
  })
  if (res.ok) {
    const blob = await res.blob()
    return {
      blob: URL.createObjectURL(blob),
      seed: res.headers.get("X-Seed"),
    }
  }
  throw await throwErrors(res)
}

export async function cancelCurrentTask(): Promise<{
  cancel_requested: boolean
  task: string | null
}> {
  const res = await api.post("/cancel-current-task")
  return res.data
}

export async function postAdjustMask(
  mask: File | Blob,
  operate: "expand" | "shrink" | "reverse",
  kernel_size: number
) {
  const maskBase64 = await convertToBase64(mask)
  const res = await fetch(`${API_ENDPOINT}/adjust_mask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mask: maskBase64,
      operate: operate,
      kernel_size: kernel_size,
    }),
  })
  if (res.ok) {
    const blob = await res.blob()
    return blob
  }
  throw await throwErrors(res)
}

// ---------------------------------------------------------------------------
// Auth API
// ---------------------------------------------------------------------------

export async function authRegister(
  username: string,
  email: string,
  password: string
): Promise<UserInfo> {
  const res = await api.post("/auth/register", { username, email, password })
  return res.data
}

export async function authLogin(
  username: string,
  password: string
): Promise<{ access_token: string; token_type: string }> {
  const res = await api.post("/auth/login", { username, password })
  return res.data
}

export async function authMe(): Promise<UserInfo> {
  const res = await api.get("/auth/me")
  return res.data
}

export async function getVramStatus() {
  const res = await api.get("/vram-status")
  return res.data
}

// ---------------------------------------------------------------------------
// Project API
// ---------------------------------------------------------------------------

export async function getProjects(): Promise<ProjectInfo[]> {
  const res = await api.get("/projects")
  return res.data
}

export async function createProject(
  name: string,
  description: string = ""
): Promise<ProjectInfo> {
  const res = await api.post("/projects", { name, description })
  return res.data
}

export async function deleteProject(projectId: string): Promise<void> {
  await api.delete(`/projects/${projectId}`)
}

// ---------------------------------------------------------------------------
// Image API
// ---------------------------------------------------------------------------

export async function getImages(
  projectId?: string,
  imageType?: string,
  skip = 0,
  limit = 50
): Promise<ImageInfo[]> {
  const params: Record<string, any> = { skip, limit }
  if (projectId) params.project_id = projectId
  if (imageType) params.image_type = imageType
  const res = await api.get("/images", { params })
  return res.data
}

export function getImageFileUrl(imageId: string): string {
  const token = getAuthToken()
  const base = `${API_ENDPOINT}/images/${imageId}/file`
  return token ? `${base}?token=${token}` : base
}

export async function deleteImage(imageId: string): Promise<void> {
  await api.delete(`/images/${imageId}`)
}
