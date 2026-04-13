export interface Filename {
  name: string
  height: number
  width: number
  ctime: number
  mtime: number
}

export interface PluginInfo {
  name: string
  support_gen_image: boolean
  support_gen_mask: boolean
}

export interface ServerConfig {
  plugins: PluginInfo[]
  modelInfos: ModelInfo[]
  removeBGModel: string
  removeBGModels: string[]
  realesrganModel: string
  realesrganModels: string[]
  interactiveSegModel: string
  interactiveSegModels: string[]
  enableFileManager: boolean
  enableAutoSaving: boolean
  enableControlnet: boolean
  controlnetMethod: string
  disableModelSwitch: boolean
  isDesktop: boolean
  samplers: string[]
  enableAuth: boolean
}

export interface GenInfo {
  prompt: string
  negative_prompt: string
}

export interface ModelInfo {
  name: string
  path: string
  model_type:
    | "inpaint"
    | "diffusers_sd"
    | "diffusers_sdxl"
    | "diffusers_sd_inpaint"
    | "diffusers_sdxl_inpaint"
    | "diffusers_other"
  support_strength: boolean
  support_outpainting: boolean
  support_controlnet: boolean
  support_brushnet: boolean
  support_powerpaint_v2: boolean
  controlnets: string[]
  brushnets: string[]
  support_lcm_lora: boolean
  support_txt2img: boolean
  need_prompt: boolean
  is_single_file_diffusers: boolean
}

export enum PluginName {
  RemoveBG = "RemoveBG",
  AnimeSeg = "AnimeSeg",
  RealESRGAN = "RealESRGAN",
  GFPGAN = "GFPGAN",
  RestoreFormer = "RestoreFormer",
  InteractiveSeg = "InteractiveSeg",
}

export interface PluginParams {
  upscale: number
}

export enum SortBy {
  NAME = "name",
  CTIME = "ctime",
  MTIME = "mtime",
}

export enum SortOrder {
  DESCENDING = "desc",
  ASCENDING = "asc",
}

export enum LDMSampler {
  ddim = "ddim",
  plms = "plms",
}

export enum CV2Flag {
  INPAINT_NS = "INPAINT_NS",
  INPAINT_TELEA = "INPAINT_TELEA",
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface Line {
  size?: number
  pts: Point[]
}

export type LineGroup = Array<Line>

export interface Size {
  width: number
  height: number
}

export enum ExtenderDirection {
  x = "x",
  y = "y",
  xy = "xy",
}

export enum PowerPaintTask {
  text_guided = "text-guided",
  shape_guided = "shape-guided",
  context_aware = "context-aware",
  object_remove = "object-remove",
  outpainting = "outpainting",
}

export type AdjustMaskOperate = "expand" | "shrink" | "reverse"

export enum WorkspaceTab {
  GENERATE = "generate",
  INPAINT = "inpaint",
  OUTPAINT = "outpaint",
  AI_REPAINT = "ai_repaint",
  REMOVE_BG = "remove_bg",
  SUPER_RES = "super_res",
  FACE_RESTORE = "face_restore",
  INTERACTIVE_SEG = "interactive_seg",
  MY_WORKSPACE = "my_workspace",
}

export interface UserInfo {
  id: string
  username: string
  email: string
  created_at: string
}

export interface ProjectInfo {
  id: string
  name: string
  description?: string
  image_count: number
  created_at: string
  updated_at: string
}

export interface ImageInfo {
  id: string
  filename: string
  image_type: string
  prompt?: string
  negative_prompt?: string
  seed?: number
  model_name?: string
  width?: number
  height?: number
  project_id?: string
  created_at: string
}

export interface WorkspaceAssetUpload {
  role: string
  kind: string
  data: string
  filename?: string
  label?: string
  mime_type?: string
  width?: number
  height?: number
  metadata?: Record<string, any>
}

export interface WorkspaceAssetInfo {
  id: string
  kind: string
  origin_feature?: string
  label?: string
  mime_type?: string
  width?: number
  height?: number
  metadata: Record<string, any>
  created_at: string
}

export interface WorkspaceOperation {
  id: string
  feature: string
  operation: string
  model_name?: string
  plugin_name?: string
  status: string
  duration_ms?: number
  request_data: Record<string, any>
  response_data: Record<string, any>
  error_message?: string
  started_at: string
  finished_at?: string
}

export interface WorkspaceSnapshot {
  id: string
  title?: string
  active_tab: string
  primary_asset_id?: string
  mask_asset_id?: string
  preview_asset_id?: string
  asset_roles: Record<string, string>
  workspace_state: Record<string, any>
  created_at: string
}

export interface WorkspaceSummary {
  id: string
  title: string
  status: string
  source_feature: string
  current_feature: string
  current_snapshot_id?: string
  primary_asset_id?: string
  preview_asset_id?: string
  last_operation_id?: string
  last_operation?: WorkspaceOperation
  created_at: string
  updated_at: string
}

export interface WorkspaceDetail {
  session: WorkspaceSummary
  latest_snapshot?: WorkspaceSnapshot
  feature_states: Record<string, any>
  operations: WorkspaceOperation[]
}

export interface WorkspaceResumePayload {
  session: WorkspaceSummary
  snapshot: WorkspaceSnapshot
  feature_states: Record<string, any>
  assets: Record<string, WorkspaceAssetInfo>
}
