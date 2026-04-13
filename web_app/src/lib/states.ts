import { persist } from "zustand/middleware"
import { shallow } from "zustand/shallow"
import { immer } from "zustand/middleware/immer"
import { castDraft } from "immer"
import { createWithEqualityFn } from "zustand/traditional"
import {
  AdjustMaskOperate,
  CV2Flag,
  ExtenderDirection,
  LDMSampler,
  Line,
  LineGroup,
  ModelInfo,
  PluginParams,
  Point,
  PowerPaintTask,
  ServerConfig,
  Size,
  SortBy,
  SortOrder,
  UserInfo,
  WorkspaceDetail,
  WorkspaceResumePayload,
  WorkspaceSummary,
  WorkspaceTab,
} from "./types"
import {
  AI_REPAINT_MODEL,
  BRUSH_COLOR,
  DEFAULT_BRUSH_SIZE,
  DEFAULT_NEGATIVE_PROMPT,
  MAX_BRUSH_SIZE,
  MODEL_TYPE_INPAINT,
  OUTPAINT_MODEL,
  PAINT_BY_EXAMPLE,
} from "./const"
import {
  blobToImage,
  canvasToImage,
  convertToBase64,
  dataURItoBlob,
  generateMask,
  loadImage,
  srcToFile,
} from "./utils"
import inpaint, {
  authLogin,
  authMe,
  authRegister,
  cancelCurrentTask as cancelCurrentTaskApi,
  deleteWorkspace,
  getGenInfo,
  getAssetFileUrl,
  getWorkspaceDetail,
  importWorkspaceFile,
  listWorkspaces,
  postAdjustMask,
  runPlugin,
  saveWorkspace as saveWorkspaceApi,
  setAuthToken,
  txt2img,
  resumeWorkspace as resumeWorkspaceApi,
} from "./api"
import { toast } from "@/components/ui/use-toast"
import axios from "axios"

type FileManagerState = {
  sortBy: SortBy
  sortOrder: SortOrder
  layout: "rows" | "masonry"
  searchText: string
  inputDirectory: string
  outputDirectory: string
}

type CropperState = {
  x: number
  y: number
  width: number
  height: number
}

type ImageRef = {
  file: File
  url: string
}

type GeneratedImage = {
  url: string
  seed: string
  file?: File
}

type UpdateSettingsOptions = {
  markDirty?: boolean
}

type FeatureResultTab =
  | WorkspaceTab.REMOVE_BG
  | WorkspaceTab.SUPER_RES
  | WorkspaceTab.FACE_RESTORE

type FeatureResultState = {
  selectedModel?: string
  selectedPlugin?: string
  sourceImage: ImageRef | null
  resultImage: ImageRef | null
  resultHistory: ImageRef[]
  resultHistoryIndex: number
}

export type Settings = {
  model: ModelInfo
  enableDownloadMask: boolean
  enableManualInpainting: boolean
  enableUploadMask: boolean
  enableAutoExtractPrompt: boolean
  showCropper: boolean
  showExtender: boolean
  extenderDirection: ExtenderDirection

  // For LDM
  ldmSteps: number
  ldmSampler: LDMSampler

  // For ZITS
  zitsWireframe: boolean

  // For OpenCV2
  cv2Radius: number
  cv2Flag: CV2Flag

  // For Diffusion moel
  prompt: string
  negativePrompt: string
  seed: number
  seedFixed: boolean

  // For SD
  sdMaskBlur: number
  sdStrength: number
  sdSteps: number
  sdGuidanceScale: number
  sdSampler: string
  sdMatchHistograms: boolean
  sdScale: number

  // Pix2Pix
  p2pImageGuidanceScale: number

  // ControlNet
  enableControlnet: boolean
  controlnetConditioningScale: number
  controlnetMethod: string

  // BrushNet
  enableBrushNet: boolean
  brushnetMethod: string
  brushnetConditioningScale: number

  enableLCMLora: boolean

  // PowerPaint
  enablePowerPaintV2: boolean
  powerpaintTask: PowerPaintTask

  // AdjustMask
  adjustMaskKernelSize: number

  // Txt2Img resolution
  txt2imgWidth: number
  txt2imgHeight: number
}

type FeatureSettingsMap = Record<WorkspaceTab, Settings>

type InteractiveSegState = {
  isInteractiveSeg: boolean
  tmpInteractiveSegMask: HTMLImageElement | null
  clicks: number[][]
}

type EditorState = {
  baseBrushSize: number
  brushSizeScale: number
  renders: HTMLImageElement[]
  lineGroups: LineGroup[]
  lastLineGroup: LineGroup
  curLineGroup: LineGroup

  // mask from interactive-seg or other segmentation models
  extraMasks: HTMLImageElement[]
  prevExtraMasks: HTMLImageElement[]

  temporaryMasks: HTMLImageElement[]
  // redo 相关
  redoRenders: HTMLImageElement[]
  redoCurLines: Line[]
  redoLineGroups: LineGroup[]
}

type AppState = {
  file: File | null
  paintByExampleFile: File | null
  customMask: File | null
  imageHeight: number
  imageWidth: number
  isInpainting: boolean
  isPluginRunning: boolean
  isAdjustingMask: boolean
  windowSize: Size
  editorState: EditorState
  disableShortCuts: boolean

  interactiveSegState: InteractiveSegState
  fileManagerState: FileManagerState

  cropperState: CropperState
  extenderState: CropperState
  isCropperExtenderResizing: boolean

  serverConfig: ServerConfig

  settings: Settings
  settingsByFeature: FeatureSettingsMap

  activeTab: WorkspaceTab
  generatedImages: GeneratedImage[]
  selectedGeneratedImageIndex: number
  pendingGeneratedHandoff: boolean
  isGenerating: boolean
  isCancelingTask: boolean
  workspaceDirty: boolean
  showReplaceImageConfirm: boolean
  pendingReplaceImage: File | null
  pendingReplaceTab: WorkspaceTab | null
  // 全局工作图片，所有标签页共享
  workingImage: ImageRef | null
  removeBgState: FeatureResultState
  superResState: FeatureResultState
  faceRestoreState: FeatureResultState

  // Auth state
  user: UserInfo | null
  token: string | null
  isAuthenticated: boolean

  // Workspace data
  currentWorkspaceSessionId: string | null
  workspaceItems: WorkspaceSummary[]
  workspaceDetail: WorkspaceDetail | null
  isSavingWorkspace: boolean
  isLoadingWorkspaces: boolean
  isLoadingWorkspaceDetail: boolean
}

type AppAction = {
  updateAppState: (newState: Partial<AppState>) => void
  setFile: (file: File) => Promise<void>
  setCustomFile: (file: File) => void
  setIsInpainting: (newValue: boolean) => void
  getIsProcessing: () => boolean
  setBaseBrushSize: (newValue: number) => void
  decreaseBaseBrushSize: () => void
  increaseBaseBrushSize: () => void
  getBrushSize: () => number
  setImageSize: (width: number, height: number) => void

  isSD: () => boolean

  setCropperX: (newValue: number) => void
  setCropperY: (newValue: number) => void
  setCropperWidth: (newValue: number) => void
  setCropperHeight: (newValue: number) => void

  setExtenderX: (newValue: number) => void
  setExtenderY: (newValue: number) => void
  setExtenderWidth: (newValue: number) => void
  setExtenderHeight: (newValue: number) => void

  setIsCropperExtenderResizing: (newValue: boolean) => void
  updateExtenderDirection: (
    newValue: ExtenderDirection,
    options?: { markDirty?: boolean }
  ) => void
  resetExtender: (width: number, height: number) => void
  updateExtenderByBuiltIn: (direction: ExtenderDirection, scale: number) => void

  setServerConfig: (newValue: ServerConfig) => void
  setSeed: (newValue: number) => void
  updateSettings: (
    newSettings: Partial<Settings>,
    options?: UpdateSettingsOptions
  ) => void

  // 互斥
  updateEnablePowerPaintV2: (newValue: boolean) => void
  updateEnableBrushNet: (newValue: boolean) => void
  updateEnableControlnet: (newValue: boolean) => void
  updateLCMLora: (newValue: boolean) => void

  setModel: (newModel: ModelInfo) => void
  updateFileManagerState: (newState: Partial<FileManagerState>) => void
  updateInteractiveSegState: (newState: Partial<InteractiveSegState>) => void
  resetInteractiveSegState: () => void
  handleInteractiveSegAccept: () => void
  handleFileManagerMaskSelect: (blob: Blob) => Promise<void>
  showPromptInput: () => boolean

  runInpainting: () => Promise<void>
  showPrevMask: () => Promise<void>
  hidePrevMask: () => void
  runRenderablePlugin: (
    genMask: boolean,
    pluginName: string,
    params?: PluginParams
  ) => Promise<void>

  // EditorState
  getCurrentTargetFile: () => Promise<File>
  updateEditorState: (newState: Partial<EditorState>) => void
  runMannually: () => boolean
  handleCanvasMouseDown: (point: Point) => void
  handleCanvasMouseMove: (point: Point) => void
  cleanCurLineGroup: () => void
  resetRedoState: () => void
  undo: () => void
  redo: () => void
  undoDisabled: () => boolean
  redoDisabled: () => boolean

  adjustMask: (operate: AdjustMaskOperate) => Promise<void>
  clearMask: () => void

  setActiveTab: (tab: WorkspaceTab) => void
  runTxt2Img: () => Promise<void>
  cancelCurrentTask: () => Promise<void>
  clearGeneratedImages: () => void
  sendToTab: (blobUrl: string, tab: WorkspaceTab) => Promise<void>
  setWorkingImage: (file: File) => void
  loadImageForTab: (file: File, tab: WorkspaceTab) => Promise<void>
  selectGeneratedImage: (index: number) => void
  hasSavableWorkspaceContent: () => boolean
  hasUnsavedWorkspaceChanges: () => boolean
  markWorkspaceDirty: () => void
  resetWorkspaceDirty: () => void
  resetWorkspaceForNewGeneration: () => void
  requestReplaceImage: (file: File, tab: WorkspaceTab) => Promise<void>
  confirmReplaceImageWithSave: () => Promise<void>
  confirmReplaceImageWithoutSave: () => Promise<void>
  cancelReplaceImage: () => void
  setFeatureSourceImage: (tab: FeatureResultTab, file: File) => void
  setFeatureResultImage: (
    tab: FeatureResultTab,
    file: File | null
  ) => void
  setFeatureSelectedModel: (
    tab: FeatureResultTab,
    value: string
  ) => void
  undoFeatureResult: (tab: FeatureResultTab) => void
  redoFeatureResult: (tab: FeatureResultTab) => void
  undoFeatureResultDisabled: (tab: FeatureResultTab) => boolean
  redoFeatureResultDisabled: (tab: FeatureResultTab) => boolean
  clearCurrentWorkspace: () => void
  saveWorkspace: () => Promise<boolean>
  fetchWorkspaces: (search?: string, feature?: string) => Promise<void>
  fetchWorkspaceDetail: (id: string) => Promise<void>
  resumeWorkspace: (id: string) => Promise<void>
  importFileToWorkspace: (file: File, title?: string) => Promise<void>
  deleteWorkspaceItem: (id: string) => Promise<void>

  // Auth actions
  login: (username: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
  logout: () => void
  restoreSession: () => Promise<void>
}

const createDefaultModelInfo = (): ModelInfo => ({
  name: "lama",
  path: "lama",
  model_type: "inpaint",
  support_controlnet: false,
  support_brushnet: false,
  support_strength: false,
  support_outpainting: false,
  support_powerpaint_v2: false,
  controlnets: [],
  brushnets: [],
  support_lcm_lora: false,
  support_txt2img: false,
  is_single_file_diffusers: false,
  need_prompt: false,
})

const cloneModelInfo = (model: ModelInfo): ModelInfo => ({
  ...model,
  controlnets: [...model.controlnets],
  brushnets: [...model.brushnets],
})

const cloneSettings = (settings: Settings): Settings => ({
  ...settings,
  model: cloneModelInfo(settings.model),
})

const createBaseSettings = (): Settings => ({
  model: createDefaultModelInfo(),
  showCropper: false,
  showExtender: false,
  extenderDirection: ExtenderDirection.xy,
  enableDownloadMask: false,
  enableManualInpainting: false,
  enableUploadMask: false,
  enableAutoExtractPrompt: true,
  ldmSteps: 30,
  ldmSampler: LDMSampler.ddim,
  zitsWireframe: true,
  cv2Radius: 5,
  cv2Flag: CV2Flag.INPAINT_NS,
  prompt: "",
  negativePrompt: DEFAULT_NEGATIVE_PROMPT,
  seed: 42,
  seedFixed: false,
  sdMaskBlur: 12,
  sdStrength: 1.0,
  sdSteps: 30,
  sdGuidanceScale: 7.5,
  sdSampler: "DPM++ 2M",
  sdMatchHistograms: false,
  sdScale: 1.0,
  p2pImageGuidanceScale: 1.5,
  enableControlnet: false,
  controlnetMethod: "lllyasviel/control_v11p_sd15_canny",
  controlnetConditioningScale: 0.4,
  enableBrushNet: false,
  brushnetMethod: "random_mask",
  brushnetConditioningScale: 1.0,
  enableLCMLora: false,
  enablePowerPaintV2: false,
  powerpaintTask: PowerPaintTask.text_guided,
  adjustMaskKernelSize: 12,
  txt2imgWidth: 512,
  txt2imgHeight: 512,
})

const createDefaultSettingsForTab = (tab: WorkspaceTab): Settings => {
  const base = createBaseSettings()

  if (tab === WorkspaceTab.OUTPAINT) {
    return {
      ...base,
      prompt: "",
      negativePrompt: "",
      showExtender: true,
      showCropper: false,
      sdStrength: 0.3,
      sdSteps: 50,
      sdGuidanceScale: 12.0,
      sdMatchHistograms: true,
      powerpaintTask: PowerPaintTask.outpainting,
    }
  }

  if (tab === WorkspaceTab.AI_REPAINT) {
    return {
      ...base,
      prompt: "",
      negativePrompt: DEFAULT_NEGATIVE_PROMPT,
      showExtender: false,
      sdSteps: 30,
      sdGuidanceScale: 7.5,
      powerpaintTask: PowerPaintTask.text_guided,
    }
  }

  if (tab === WorkspaceTab.GENERATE) {
    return {
      ...base,
      prompt: "",
      negativePrompt: DEFAULT_NEGATIVE_PROMPT,
      showExtender: false,
      showCropper: false,
      txt2imgWidth: 1024,
      txt2imgHeight: 1024,
      sdSteps: 30,
      sdGuidanceScale: 6.0,
    }
  }

  if (tab === WorkspaceTab.INPAINT) {
    return {
      ...base,
      prompt: "",
      negativePrompt: DEFAULT_NEGATIVE_PROMPT,
      showExtender: false,
      showCropper: false,
      sdSteps: 30,
      sdGuidanceScale: 7.5,
    }
  }

  return base
}

const createDefaultSettingsByFeature = (): FeatureSettingsMap => ({
  [WorkspaceTab.GENERATE]: createDefaultSettingsForTab(WorkspaceTab.GENERATE),
  [WorkspaceTab.INPAINT]: createDefaultSettingsForTab(WorkspaceTab.INPAINT),
  [WorkspaceTab.OUTPAINT]: createDefaultSettingsForTab(WorkspaceTab.OUTPAINT),
  [WorkspaceTab.AI_REPAINT]: createDefaultSettingsForTab(WorkspaceTab.AI_REPAINT),
  [WorkspaceTab.REMOVE_BG]: createDefaultSettingsForTab(WorkspaceTab.REMOVE_BG),
  [WorkspaceTab.SUPER_RES]: createDefaultSettingsForTab(WorkspaceTab.SUPER_RES),
  [WorkspaceTab.FACE_RESTORE]: createDefaultSettingsForTab(WorkspaceTab.FACE_RESTORE),
  [WorkspaceTab.INTERACTIVE_SEG]: createDefaultSettingsForTab(
    WorkspaceTab.INTERACTIVE_SEG
  ),
  [WorkspaceTab.MY_WORKSPACE]: createDefaultSettingsForTab(WorkspaceTab.MY_WORKSPACE),
})

const createEmptyFeatureResultState = (): FeatureResultState => ({
  selectedModel: undefined,
  selectedPlugin: undefined,
  sourceImage: null,
  resultImage: null,
  resultHistory: [],
  resultHistoryIndex: -1,
})

const revokeImageRef = (ref: ImageRef | null) => {
  if (ref?.url) URL.revokeObjectURL(ref.url)
}

const makeImageRef = (file: File): ImageRef => ({
  file,
  url: URL.createObjectURL(file),
})

const revokeGeneratedImages = (images: GeneratedImage[]) => {
  images.forEach((image) => {
    if (image.url) {
      URL.revokeObjectURL(image.url)
    }
  })
}

const revokeImageRefs = (refs: ImageRef[]) => {
  refs.forEach((ref) => revokeImageRef(ref))
}

const clearFeatureResultState = (state: FeatureResultState) => {
  revokeImageRef(state.sourceImage)
  state.sourceImage = null
  clearFeatureResultHistory(state)
  state.selectedModel = undefined
  state.selectedPlugin = undefined
}

const clearFeatureResultHistory = (state: FeatureResultState) => {
  revokeImageRefs(state.resultHistory)
  state.resultHistory = []
  state.resultHistoryIndex = -1
  state.resultImage = null
}

const pushFeatureResultHistory = (state: FeatureResultState, file: File) => {
  const redoRefs = state.resultHistory.slice(state.resultHistoryIndex + 1)
  revokeImageRefs(redoRefs)
  state.resultHistory = state.resultHistory.slice(0, state.resultHistoryIndex + 1)

  const next = makeImageRef(file)
  state.resultHistory.push(next)
  state.resultHistoryIndex = state.resultHistory.length - 1
  state.resultImage = castDraft(next)
}

const syncFeatureResultImage = (state: FeatureResultState) => {
  state.resultImage =
    state.resultHistoryIndex >= 0
      ? castDraft(state.resultHistory[state.resultHistoryIndex])
      : null
}

const EDITOR_TABS = [
  WorkspaceTab.INPAINT,
  WorkspaceTab.OUTPAINT,
  WorkspaceTab.AI_REPAINT,
  WorkspaceTab.INTERACTIVE_SEG,
]

const FEATURE_RESULT_TABS = [
  WorkspaceTab.REMOVE_BG,
  WorkspaceTab.SUPER_RES,
  WorkspaceTab.FACE_RESTORE,
]

const defaultValues: AppState = {
  file: null,
  paintByExampleFile: null,
  customMask: null,
  imageHeight: 0,
  imageWidth: 0,
  isInpainting: false,
  isPluginRunning: false,
  isAdjustingMask: false,
  disableShortCuts: false,

  windowSize: {
    height: 600,
    width: 800,
  },
  editorState: {
    baseBrushSize: DEFAULT_BRUSH_SIZE,
    brushSizeScale: 1,
    renders: [],
    extraMasks: [],
    prevExtraMasks: [],
    temporaryMasks: [],
    lineGroups: [],
    lastLineGroup: [],
    curLineGroup: [],
    redoRenders: [],
    redoCurLines: [],
    redoLineGroups: [],
  },

  interactiveSegState: {
    isInteractiveSeg: false,
    tmpInteractiveSegMask: null,
    clicks: [],
  },

  cropperState: {
    x: 0,
    y: 0,
    width: 512,
    height: 512,
  },
  extenderState: {
    x: 0,
    y: 0,
    width: 512,
    height: 512,
  },
  isCropperExtenderResizing: false,

  fileManagerState: {
    sortBy: SortBy.CTIME,
    sortOrder: SortOrder.DESCENDING,
    layout: "masonry",
    searchText: "",
    inputDirectory: "",
    outputDirectory: "",
  },
  serverConfig: {
    plugins: [],
    modelInfos: [],
    removeBGModel: "briaai/RMBG-1.4",
    removeBGModels: [],
    realesrganModel: "realesr-general-x4v3",
    realesrganModels: [],
    interactiveSegModel: "vit_b",
    interactiveSegModels: [],
    enableFileManager: false,
    enableAutoSaving: false,
    enableControlnet: false,
    controlnetMethod: "lllyasviel/control_v11p_sd15_canny",
    disableModelSwitch: false,
    isDesktop: false,
    samplers: ["DPM++ 2M SDE Karras"],
    enableAuth: true,
  },
  settings: createDefaultSettingsForTab(WorkspaceTab.INPAINT),
  settingsByFeature: createDefaultSettingsByFeature(),

  activeTab: WorkspaceTab.INPAINT,
  generatedImages: [],
  selectedGeneratedImageIndex: 0,
  pendingGeneratedHandoff: false,
  isGenerating: false,
  isCancelingTask: false,
  workspaceDirty: false,
  showReplaceImageConfirm: false,
  pendingReplaceImage: null,
  pendingReplaceTab: null,
  workingImage: null,
  removeBgState: createEmptyFeatureResultState(),
  superResState: createEmptyFeatureResultState(),
  faceRestoreState: createEmptyFeatureResultState(),

  user: null,
  token: null,
  isAuthenticated: false,

  currentWorkspaceSessionId: null,
  workspaceItems: [],
  workspaceDetail: null,
  isSavingWorkspace: false,
  isLoadingWorkspaces: false,
  isLoadingWorkspaceDetail: false,
}

export const useStore = createWithEqualityFn<AppState & AppAction>()(
  persist(
    immer((set, get) => ({
      ...defaultValues,

      showPrevMask: async () => {
        if (get().settings.showExtender) {
          return
        }
        const { lastLineGroup, curLineGroup, prevExtraMasks, extraMasks } =
          get().editorState
        if (curLineGroup.length !== 0 || extraMasks.length !== 0) {
          return
        }
        const { imageWidth, imageHeight } = get()

        const maskCanvas = generateMask(
          imageWidth,
          imageHeight,
          [lastLineGroup],
          prevExtraMasks,
          BRUSH_COLOR
        )
        try {
          const maskImage = await canvasToImage(maskCanvas)
          set((state) => {
            state.editorState.temporaryMasks.push(castDraft(maskImage))
          })
        } catch (e) {
          console.error(e)
          return
        }
      },
      hidePrevMask: () => {
        set((state) => {
          state.editorState.temporaryMasks = []
        })
      },

      getCurrentTargetFile: async (): Promise<File> => {
        const file = get().file! // 一定是在 file 加载了以后才可能调用这个函数
        const renders = get().editorState.renders

        let targetFile = file
        if (renders.length > 0) {
          const lastRender = renders[renders.length - 1]
          targetFile = await srcToFile(
            lastRender.currentSrc,
            file.name,
            file.type
          )
        }
        return targetFile
      },

      runInpainting: async () => {
        const {
          isInpainting,
          file,
          paintByExampleFile,
          imageWidth,
          imageHeight,
          settings,
          activeTab,
          cropperState,
          extenderState,
        } = get()
        if (isInpainting || file === null) {
          return
        }
        if (
          get().settings.model.support_outpainting &&
          settings.showExtender &&
          extenderState.x === 0 &&
          extenderState.y === 0 &&
          extenderState.height === imageHeight &&
          extenderState.width === imageWidth
        ) {
          return
        }

        const {
          lastLineGroup,
          curLineGroup,
          lineGroups,
          renders,
          prevExtraMasks,
          extraMasks,
        } = get().editorState

        const useLastLineGroup =
          curLineGroup.length === 0 &&
          extraMasks.length === 0 &&
          !settings.showExtender

        // useLastLineGroup 的影响
        // 1. 使用上一次的 mask
        // 2. 结果替换当前 render
        let maskImages: HTMLImageElement[] = []
        let maskLineGroup: LineGroup = []
        if (useLastLineGroup === true) {
          maskLineGroup = lastLineGroup
          maskImages = prevExtraMasks
        } else {
          maskLineGroup = curLineGroup
          maskImages = extraMasks
        }

        if (
          maskLineGroup.length === 0 &&
          maskImages === null &&
          !settings.showExtender
        ) {
          toast({
            variant: "destructive",
            description: "Please draw mask on picture",
          })
          return
        }

        const newLineGroups = [...lineGroups, maskLineGroup]

        set((state) => {
          state.isInpainting = true
          state.isCancelingTask = false
        })

        let targetFile = file
        if (useLastLineGroup === true) {
          // renders.length == 1 还是用原来的
          if (renders.length > 1) {
            const lastRender = renders[renders.length - 2]
            targetFile = await srcToFile(
              lastRender.currentSrc,
              file.name,
              file.type
            )
          }
        } else if (renders.length > 0) {
          const lastRender = renders[renders.length - 1]
          targetFile = await srcToFile(
            lastRender.currentSrc,
            file.name,
            file.type
          )
        }

        const maskCanvas = generateMask(
          imageWidth,
          imageHeight,
          [maskLineGroup],
          maskImages,
          BRUSH_COLOR
        )
        if (useLastLineGroup) {
          const temporaryMask = await canvasToImage(maskCanvas)
          set((state) => {
            state.editorState.temporaryMasks = castDraft([temporaryMask])
          })
        }

        try {
          const inpaintTaskType =
            activeTab === WorkspaceTab.AI_REPAINT
              ? "repaint"
              : activeTab === WorkspaceTab.OUTPAINT
              ? "outpaint"
              : "inpaint"

          // AI重绘/外扩固定使用 PowerPaint，缺失时在前端提前拦截，避免不透明的 422。
          const fixedTaskModelName =
            inpaintTaskType === "repaint"
              ? AI_REPAINT_MODEL
              : inpaintTaskType === "outpaint"
              ? OUTPAINT_MODEL
              : null
          if (fixedTaskModelName) {
            const fixedModelInfo = get().serverConfig.modelInfos.find(
              (m) => m.name === fixedTaskModelName
            )
            if (!fixedModelInfo) {
              toast({
                variant: "destructive",
                title: "Missing required model",
                description:
                  `当前任务需要模型 ${fixedTaskModelName}，但本地不可用。` +
                  "请先下载该模型（或去掉 --local-files-only 后重启让程序自动下载）。",
              })
              set((state) => {
                state.isInpainting = false
                state.isCancelingTask = false
                state.editorState.temporaryMasks = []
              })
              return
            }
            if (settings.model.name !== fixedTaskModelName) {
              get().updateSettings(
                { model: fixedModelInfo },
                { markDirty: false }
              )
            }
          }

          const res = await inpaint(
            targetFile,
            settings,
            inpaintTaskType,
            cropperState,
            extenderState,
            dataURItoBlob(maskCanvas.toDataURL()),
            paintByExampleFile,
            get().currentWorkspaceSessionId ?? undefined
          )

          const { blob, seed } = res
          if (seed) {
            get().setSeed(parseInt(seed, 10))
          }
          const newRender = new Image()
          await loadImage(newRender, blob)
          const newRenders = [...renders, newRender]
          get().setImageSize(newRender.width, newRender.height)
          get().updateEditorState({
            renders: newRenders,
            lineGroups: newLineGroups,
            lastLineGroup: maskLineGroup,
            curLineGroup: [],
            extraMasks: [],
            prevExtraMasks: maskImages,
          })
          get().markWorkspaceDirty()
        } catch (e: any) {
          toast({
            variant: "destructive",
            description: e.message ? e.message : e.toString(),
          })
        }

        get().resetRedoState()
        set((state) => {
          state.isInpainting = false
          state.isCancelingTask = false
          state.editorState.temporaryMasks = []
        })
      },

      runRenderablePlugin: async (
        genMask: boolean,
        pluginName: string,
        params: PluginParams = { upscale: 1 }
      ) => {
        const { renders, lineGroups } = get().editorState
        set((state) => {
          state.isPluginRunning = true
        })

        try {
          const start = new Date()
          const targetFile = await get().getCurrentTargetFile()
          const res = await runPlugin(
            genMask,
            pluginName,
            targetFile,
            params.upscale,
            undefined,
            get().currentWorkspaceSessionId ?? undefined
          )
          const { blob } = res

          if (!genMask) {
            const newRender = new Image()
            await loadImage(newRender, blob)
            get().setImageSize(newRender.width, newRender.height)
            const newRenders = [...renders, newRender]
            const newLineGroups = [...lineGroups, []]
            get().updateEditorState({
              renders: newRenders,
              lineGroups: newLineGroups,
            })
          } else {
            const newMask = new Image()
            await loadImage(newMask, blob)
            set((state) => {
              state.editorState.extraMasks.push(castDraft(newMask))
            })
          }
          get().markWorkspaceDirty()
          const end = new Date()
          const time = end.getTime() - start.getTime()
          toast({
            description: `Run ${pluginName} successfully in ${time / 1000}s`,
          })
        } catch (e: any) {
          toast({
            variant: "destructive",
            description: e.message ? e.message : e.toString(),
          })
        }
        set((state) => {
          state.isPluginRunning = false
        })
      },

      // Edirot State //
      updateEditorState: (newState: Partial<EditorState>) => {
        set((state) => {
          state.editorState = castDraft({ ...state.editorState, ...newState })
        })
      },

      cleanCurLineGroup: () => {
        get().updateEditorState({ curLineGroup: [] })
      },

      handleCanvasMouseDown: (point: Point) => {
        let lineGroup: LineGroup = []
        const state = get()
        if (state.runMannually()) {
          lineGroup = [...state.editorState.curLineGroup]
        }
        lineGroup.push({ size: state.getBrushSize(), pts: [point] })
        set((state) => {
          state.editorState.curLineGroup = lineGroup
          state.workspaceDirty = true
        })
      },

      handleCanvasMouseMove: (point: Point) => {
        set((state) => {
          const curLineGroup = state.editorState.curLineGroup
          if (curLineGroup.length) {
            curLineGroup[curLineGroup.length - 1].pts.push(point)
          }
        })
      },

      runMannually: (): boolean => {
        const state = get()
        return (
          state.settings.enableManualInpainting ||
          state.settings.model.model_type !== MODEL_TYPE_INPAINT
        )
      },

      getIsProcessing: (): boolean => {
        return (
          get().isInpainting || get().isPluginRunning || get().isAdjustingMask
        )
      },

      isSD: (): boolean => {
        return get().settings.model.model_type !== MODEL_TYPE_INPAINT
      },

      // undo/redo

      undoDisabled: (): boolean => {
        const editorState = get().editorState
        if (editorState.renders.length > 0) {
          return false
        }
        if (get().runMannually()) {
          if (editorState.curLineGroup.length === 0) {
            return true
          }
        } else if (editorState.renders.length === 0) {
          return true
        }
        return false
      },

      undo: () => {
        if (
          get().runMannually() &&
          get().editorState.curLineGroup.length !== 0
        ) {
          // undoStroke
          set((state) => {
            const editorState = state.editorState
            if (editorState.curLineGroup.length === 0) {
              return
            }
            editorState.lastLineGroup = []
            const lastLine = editorState.curLineGroup.pop()!
            editorState.redoCurLines.push(lastLine)
          })
        } else {
          set((state) => {
            const editorState = state.editorState
            if (
              editorState.renders.length === 0 ||
              editorState.lineGroups.length === 0
            ) {
              return
            }
            const lastLineGroup = editorState.lineGroups.pop()!
            editorState.redoLineGroups.push(lastLineGroup)
            editorState.redoCurLines = []
            editorState.curLineGroup = []

            const lastRender = editorState.renders.pop()!
            editorState.redoRenders.push(lastRender)
          })
        }
      },

      redoDisabled: (): boolean => {
        const editorState = get().editorState
        if (editorState.redoRenders.length > 0) {
          return false
        }
        if (get().runMannually()) {
          if (editorState.redoCurLines.length === 0) {
            return true
          }
        } else if (editorState.redoRenders.length === 0) {
          return true
        }
        return false
      },

      redo: () => {
        if (
          get().runMannually() &&
          get().editorState.redoCurLines.length !== 0
        ) {
          set((state) => {
            const editorState = state.editorState
            if (editorState.redoCurLines.length === 0) {
              return
            }
            const line = editorState.redoCurLines.pop()!
            editorState.curLineGroup.push(line)
          })
        } else {
          set((state) => {
            const editorState = state.editorState
            if (
              editorState.redoRenders.length === 0 ||
              editorState.redoLineGroups.length === 0
            ) {
              return
            }
            const lastLineGroup = editorState.redoLineGroups.pop()!
            editorState.lineGroups.push(lastLineGroup)
            editorState.curLineGroup = []

            const lastRender = editorState.redoRenders.pop()!
            editorState.renders.push(lastRender)
          })
        }
      },

      resetRedoState: () => {
        set((state) => {
          state.editorState.redoCurLines = []
          state.editorState.redoLineGroups = []
          state.editorState.redoRenders = []
        })
      },

      //****//

      updateAppState: (newState: Partial<AppState>) => {
        set(() => newState)
      },

      hasSavableWorkspaceContent: () => {
        const state = get()
        return (
          state.generatedImages.length > 0 ||
          !!state.file ||
          !!state.removeBgState.sourceImage ||
          !!state.removeBgState.resultImage ||
          !!state.superResState.sourceImage ||
          !!state.superResState.resultImage ||
          !!state.faceRestoreState.sourceImage ||
          !!state.faceRestoreState.resultImage
        )
      },

      hasUnsavedWorkspaceChanges: () => {
        return get().workspaceDirty
      },

      markWorkspaceDirty: () => {
        set((state) => {
          state.workspaceDirty = true
        })
      },

      resetWorkspaceDirty: () => {
        set((state) => {
          state.workspaceDirty = false
        })
      },

      getBrushSize: (): number => {
        return (
          get().editorState.baseBrushSize * get().editorState.brushSizeScale
        )
      },

      showPromptInput: (): boolean => {
        const model = get().settings.model
        return (
          model.model_type !== MODEL_TYPE_INPAINT &&
          model.name !== PAINT_BY_EXAMPLE
        )
      },

      setServerConfig: (newValue: ServerConfig) => {
        set((state) => {
          state.serverConfig = newValue
          state.settings.enableControlnet = newValue.enableControlnet
          state.settings.controlnetMethod = newValue.controlnetMethod
          for (const tab of Object.values(WorkspaceTab) as WorkspaceTab[]) {
            state.settingsByFeature[tab].enableControlnet =
              newValue.enableControlnet
            state.settingsByFeature[tab].controlnetMethod =
              newValue.controlnetMethod
          }
        })
      },

      updateSettings: (
        newSettings: Partial<Settings>,
        options: UpdateSettingsOptions = {}
      ) => {
        set((state) => {
          const merged = {
            ...state.settings,
            ...newSettings,
          }
          state.settings = merged
          state.settingsByFeature[state.activeTab] = castDraft(
            cloneSettings(merged)
          )
          if (options.markDirty !== false) {
            state.workspaceDirty = true
          }
        })
      },

      updateEnablePowerPaintV2: (newValue: boolean) => {
        get().updateSettings({ enablePowerPaintV2: newValue })
        if (newValue) {
          get().updateSettings({
            enableBrushNet: false,
            enableControlnet: false,
            enableLCMLora: false,
          })
        }
      },

      updateEnableBrushNet: (newValue: boolean) => {
        get().updateSettings({ enableBrushNet: newValue })
        if (newValue) {
          get().updateSettings({
            enablePowerPaintV2: false,
            enableControlnet: false,
            enableLCMLora: false,
          })
        }
      },

      updateEnableControlnet(newValue) {
        get().updateSettings({ enableControlnet: newValue })
        if (newValue) {
          get().updateSettings({
            enablePowerPaintV2: false,
            enableBrushNet: false,
          })
        }
      },

      updateLCMLora(newValue) {
        get().updateSettings({ enableLCMLora: newValue })
        if (newValue) {
          get().updateSettings({
            enablePowerPaintV2: false,
            enableBrushNet: false,
          })
        }
      },

      setModel: (newModel: ModelInfo) => {
        set((state) => {
          state.settings.model = newModel

          if (
            newModel.support_controlnet &&
            !newModel.controlnets.includes(state.settings.controlnetMethod)
          ) {
            state.settings.controlnetMethod = newModel.controlnets[0]
          }
          state.settingsByFeature[state.activeTab] = castDraft(
            cloneSettings(state.settings)
          )
          state.workspaceDirty = true
        })
      },

      updateFileManagerState: (newState: Partial<FileManagerState>) => {
        set((state) => {
          state.fileManagerState = {
            ...state.fileManagerState,
            ...newState,
          }
        })
      },

      updateInteractiveSegState: (newState: Partial<InteractiveSegState>) => {
        set((state) => {
          return {
            ...state,
            interactiveSegState: {
              ...state.interactiveSegState,
              ...newState,
            },
          }
        })
      },

      resetInteractiveSegState: () => {
        get().updateInteractiveSegState(defaultValues.interactiveSegState)
      },

      handleInteractiveSegAccept: () => {
        set((state) => {
          if (state.interactiveSegState.tmpInteractiveSegMask) {
            state.editorState.extraMasks.push(
              castDraft(state.interactiveSegState.tmpInteractiveSegMask)
            )
            state.workspaceDirty = true
          }
          state.interactiveSegState = castDraft({
            ...defaultValues.interactiveSegState,
          })
        })
      },

      handleFileManagerMaskSelect: async (blob: Blob) => {
        const newMask = new Image()

        await loadImage(newMask, URL.createObjectURL(blob))
        set((state) => {
          state.editorState.extraMasks.push(castDraft(newMask))
          state.workspaceDirty = true
        })
        get().runInpainting()
      },

      setIsInpainting: (newValue: boolean) =>
        set((state) => {
          state.isInpainting = newValue
        }),

      setFile: async (file: File) => {
        const autoPromptTabs = [
          WorkspaceTab.INPAINT,
          WorkspaceTab.AI_REPAINT,
          WorkspaceTab.GENERATE,
        ]

        set((state) => {
          state.file = file
          state.interactiveSegState = castDraft(
            defaultValues.interactiveSegState
          )
          state.editorState = castDraft(defaultValues.editorState)
          state.cropperState = defaultValues.cropperState
          state.workspaceDirty = true
        })

        if (
          get().settings.enableAutoExtractPrompt &&
          autoPromptTabs.includes(get().activeTab)
        ) {
          try {
            const res = await getGenInfo(file)
            if (get().file !== file) {
              return
            }
            if (res.prompt) {
              get().updateSettings({ prompt: res.prompt }, { markDirty: false })
            }
            if (res.negative_prompt) {
              get().updateSettings(
                { negativePrompt: res.negative_prompt },
                { markDirty: false }
              )
            }
          } catch (e: any) {
            toast({
              variant: "destructive",
              description: e.message ? e.message : e.toString(),
            })
          }
        }
      },

      setCustomFile: (file: File) =>
        set((state) => {
          state.customMask = file
          state.workspaceDirty = true
        }),

      setBaseBrushSize: (newValue: number) =>
        set((state) => {
          state.editorState.baseBrushSize = newValue
        }),

      decreaseBaseBrushSize: () => {
        const baseBrushSize = get().editorState.baseBrushSize
        let newBrushSize = baseBrushSize
        if (baseBrushSize > 10) {
          newBrushSize = baseBrushSize - 10
        }
        if (baseBrushSize <= 10 && baseBrushSize > 0) {
          newBrushSize = baseBrushSize - 3
        }
        get().setBaseBrushSize(newBrushSize)
      },

      increaseBaseBrushSize: () => {
        const baseBrushSize = get().editorState.baseBrushSize
        const newBrushSize = Math.min(baseBrushSize + 10, MAX_BRUSH_SIZE)
        get().setBaseBrushSize(newBrushSize)
      },

      setImageSize: (width: number, height: number) => {
        // 根据图片尺寸调整 brushSize 的 scale
        set((state) => {
          state.imageWidth = width
          state.imageHeight = height
          state.editorState.brushSizeScale =
            Math.max(Math.min(width, height), 512) / 512
        })
        get().resetExtender(width, height)
      },

      setCropperX: (newValue: number) =>
        set((state) => {
          state.cropperState.x = newValue
        }),

      setCropperY: (newValue: number) =>
        set((state) => {
          state.cropperState.y = newValue
        }),

      setCropperWidth: (newValue: number) =>
        set((state) => {
          state.cropperState.width = newValue
        }),

      setCropperHeight: (newValue: number) =>
        set((state) => {
          state.cropperState.height = newValue
        }),

      setExtenderX: (newValue: number) =>
        set((state) => {
          state.extenderState.x = newValue
        }),

      setExtenderY: (newValue: number) =>
        set((state) => {
          state.extenderState.y = newValue
        }),

      setExtenderWidth: (newValue: number) =>
        set((state) => {
          state.extenderState.width = newValue
        }),

      setExtenderHeight: (newValue: number) =>
        set((state) => {
          state.extenderState.height = newValue
        }),

      setIsCropperExtenderResizing: (newValue: boolean) =>
        set((state) => {
          state.isCropperExtenderResizing = newValue
        }),

      updateExtenderDirection: (
        newValue: ExtenderDirection,
        options: { markDirty?: boolean } = {}
      ) => {
        console.log(
          `updateExtenderDirection: ${JSON.stringify(get().extenderState)}`
        )
        set((state) => {
          state.settings.extenderDirection = newValue
          state.extenderState.x = 0
          state.extenderState.y = 0
          state.extenderState.width = state.imageWidth
          state.extenderState.height = state.imageHeight
          if (options.markDirty !== false) {
            state.workspaceDirty = true
          }
        })
        get().updateExtenderByBuiltIn(newValue, 1.5)
      },

      updateExtenderByBuiltIn: (
        direction: ExtenderDirection,
        scale: number
      ) => {
        const newExtenderState = { ...defaultValues.extenderState }
        let { x, y, width, height } = newExtenderState
        const { imageWidth, imageHeight } = get()
        width = imageWidth
        height = imageHeight

        switch (direction) {
          case ExtenderDirection.x:
            x = -Math.ceil((imageWidth * (scale - 1)) / 2)
            width = Math.ceil(imageWidth * scale)
            break
          case ExtenderDirection.y:
            y = -Math.ceil((imageHeight * (scale - 1)) / 2)
            height = Math.ceil(imageHeight * scale)
            break
          case ExtenderDirection.xy:
            x = -Math.ceil((imageWidth * (scale - 1)) / 2)
            y = -Math.ceil((imageHeight * (scale - 1)) / 2)
            width = Math.ceil(imageWidth * scale)
            height = Math.ceil(imageHeight * scale)
            break
          default:
            break
        }

        set((state) => {
          state.extenderState.x = x
          state.extenderState.y = y
          state.extenderState.width = width
          state.extenderState.height = height
        })
      },

      resetExtender: (width: number, height: number) => {
        set((state) => {
          state.extenderState.x = 0
          state.extenderState.y = 0
          state.extenderState.width = width
          state.extenderState.height = height
        })
      },

      setSeed: (newValue: number) =>
        set((state) => {
          state.settings.seed = newValue
          state.settingsByFeature[state.activeTab].seed = newValue
          state.workspaceDirty = true
        }),

      adjustMask: async (operate: AdjustMaskOperate) => {
        const { imageWidth, imageHeight } = get()
        const { curLineGroup, extraMasks } = get().editorState
        const { adjustMaskKernelSize } = get().settings
        if (curLineGroup.length === 0 && extraMasks.length === 0) {
          return
        }

        set((state) => {
          state.isAdjustingMask = true
        })

        const maskCanvas = generateMask(
          imageWidth,
          imageHeight,
          [curLineGroup],
          extraMasks,
          BRUSH_COLOR
        )
        const maskBlob = dataURItoBlob(maskCanvas.toDataURL())
        const newMaskBlob = await postAdjustMask(
          maskBlob,
          operate,
          adjustMaskKernelSize
        )
        const newMask = await blobToImage(newMaskBlob)

        // TODO: currently ignore stroke undo/redo
        set((state) => {
          state.editorState.extraMasks = [castDraft(newMask)]
          state.editorState.curLineGroup = []
          state.workspaceDirty = true
        })

        set((state) => {
          state.isAdjustingMask = false
        })
      },
      clearMask: () => {
        set((state) => {
          state.editorState.extraMasks = []
          state.editorState.curLineGroup = []
          state.workspaceDirty = true
        })
      },

      setActiveTab: (tab: WorkspaceTab) => {
        const prevTab = get().activeTab
        const canSyncFromGenerate =
          prevTab === WorkspaceTab.GENERATE && get().pendingGeneratedHandoff
        const shouldSyncToFeatureTab =
          prevTab !== tab &&
          FEATURE_RESULT_TABS.includes(tab) &&
          (prevTab !== WorkspaceTab.GENERATE || canSyncFromGenerate)
        const shouldSyncToEditorTab =
          prevTab !== tab &&
          EDITOR_TABS.includes(tab) &&
          (FEATURE_RESULT_TABS.includes(prevTab) ||
            canSyncFromGenerate)
        const shouldSyncImageOnTabSwitch =
          shouldSyncToFeatureTab || shouldSyncToEditorTab

        const resolveCurrentTabImage = async (): Promise<File | null> => {
          if (EDITOR_TABS.includes(prevTab)) {
            const currentFile = get().file
            if (!currentFile) {
              return get().workingImage?.file ?? null
            }

            const renders = get().editorState.renders
            if (renders.length > 0) {
              const lastRender = renders[renders.length - 1]
              return srcToFile(
                lastRender.currentSrc,
                currentFile.name,
                currentFile.type
              )
            }
            return currentFile
          }

          if (prevTab === WorkspaceTab.GENERATE) {
            const selected =
              get().generatedImages[get().selectedGeneratedImageIndex] ??
              get().generatedImages[0]
            if (!selected) {
              return get().workingImage?.file ?? null
            }
            if (selected.file) {
              return selected.file
            }
            const response = await fetch(selected.url)
            const blob = await response.blob()
            return new File([blob], "generated.png", {
              type: blob.type || "image/png",
            })
          }

          if (prevTab === WorkspaceTab.REMOVE_BG) {
            return (
              get().removeBgState.resultImage?.file ??
              get().removeBgState.sourceImage?.file ??
              get().workingImage?.file ??
              null
            )
          }

          if (prevTab === WorkspaceTab.SUPER_RES) {
            return (
              get().superResState.resultImage?.file ??
              get().superResState.sourceImage?.file ??
              get().workingImage?.file ??
              null
            )
          }

          if (prevTab === WorkspaceTab.FACE_RESTORE) {
            return (
              get().faceRestoreState.resultImage?.file ??
              get().faceRestoreState.sourceImage?.file ??
              get().workingImage?.file ??
              null
            )
          }

          return get().workingImage?.file ?? get().file ?? null
        }

        // 离开画布标签页时，快照最新编辑结果到 workingImage
        if (EDITOR_TABS.includes(prevTab)) {
          const renders = get().editorState.renders
          if (renders.length > 0) {
            const lastRender = renders[renders.length - 1]
            srcToFile(lastRender.currentSrc, "canvas.png", "image/png").then(file => {
              const url = URL.createObjectURL(file)
              const old = get().workingImage
              if (old?.url) URL.revokeObjectURL(old.url)
              set(state => { state.workingImage = castDraft({ file, url }) })
            }).catch(console.error)
          } else if (get().file) {
            // 没有编辑过，用原始 file 更新 workingImage
            const f = get().file!
            const url = URL.createObjectURL(f)
            const old = get().workingImage
            if (old?.url) URL.revokeObjectURL(old.url)
            set(state => { state.workingImage = castDraft({ file: f, url }) })
          }
        }

        if (shouldSyncImageOnTabSwitch) {
          resolveCurrentTabImage()
            .then((sourceFile) => {
              if (!sourceFile) {
                return
              }
              return get().loadImageForTab(sourceFile, tab).then(() => {
                if (canSyncFromGenerate) {
                  set((state) => {
                    state.pendingGeneratedHandoff = false
                  })
                }
              })
            })
            .catch(console.error)
        }

        set((state) => {
            state.settingsByFeature[prevTab] = castDraft(
              cloneSettings(state.settings)
            )
            state.activeTab = tab
        })

        // 进入画布标签页时，如果 workingImage 存在且 file 为空，自动加载
        if (EDITOR_TABS.includes(tab) && !shouldSyncToEditorTab) {
          const wi = get().workingImage
          if (wi && !get().file) {
            get().setFile(wi.file)
          }
        }

        // tab 切换仅更新前端使用的模型元数据，不触发后端切模。
        const modelInfos = get().serverConfig.modelInfos
        const findModel = (name: string) =>
          modelInfos.find((m) => m.name === name)

        const savedSettings = get().settingsByFeature[tab]
          ? cloneSettings(get().settingsByFeature[tab])
          : createDefaultSettingsForTab(tab)

        let tabModel: ModelInfo | undefined
        if (tab === WorkspaceTab.INPAINT) {
          tabModel =
            findModel("lama") ?? modelInfos.find((m) => m.model_type === MODEL_TYPE_INPAINT)
        } else if (tab === WorkspaceTab.OUTPAINT) {
          tabModel = findModel(OUTPAINT_MODEL)
        } else if (tab === WorkspaceTab.AI_REPAINT) {
          tabModel = findModel(AI_REPAINT_MODEL)
        } else if (tab === WorkspaceTab.GENERATE) {
          if (savedSettings.model.support_txt2img) {
            tabModel = savedSettings.model
          } else {
            tabModel =
              findModel("stabilityai/stable-diffusion-xl-base-1.0") ??
              modelInfos.find((m) => m.support_txt2img)
          }
        }

        if (tabModel) {
          set((state) => {
            savedSettings.model = tabModel
            if (tab === WorkspaceTab.OUTPAINT) {
              savedSettings.showExtender = true
              savedSettings.showCropper = false
            }
            state.settings = castDraft(cloneSettings(savedSettings))
            state.settingsByFeature[tab] = castDraft(cloneSettings(savedSettings))
          })
        } else {
          set((state) => {
            if (tab === WorkspaceTab.OUTPAINT) {
              savedSettings.showExtender = true
              savedSettings.showCropper = false
            }
            state.settings = castDraft(cloneSettings(savedSettings))
            state.settingsByFeature[tab] = castDraft(cloneSettings(savedSettings))
          })
        }
      },

      clearGeneratedImages: () => {
        set((state) => {
          revokeGeneratedImages(state.generatedImages)
          state.generatedImages = []
          state.selectedGeneratedImageIndex = 0
          state.pendingGeneratedHandoff = false
          state.workspaceDirty = true
        })
      },

      selectGeneratedImage: (index: number) => {
        set((state) => {
          if (state.selectedGeneratedImageIndex !== index) {
            state.workspaceDirty = true
          }
          state.selectedGeneratedImageIndex = index
        })

        const selected = get().generatedImages[index]
        if (selected?.file) {
          get().setWorkingImage(selected.file)
        }
      },

      resetWorkspaceForNewGeneration: () => {
        set((state) => {
          revokeGeneratedImages(state.generatedImages)
          revokeImageRef(state.workingImage)
          clearFeatureResultState(state.removeBgState)
          clearFeatureResultState(state.superResState)
          clearFeatureResultState(state.faceRestoreState)

          state.file = null
          state.paintByExampleFile = null
          state.customMask = null
          state.imageHeight = 0
          state.imageWidth = 0
          state.editorState = castDraft(defaultValues.editorState)
          state.interactiveSegState = castDraft(defaultValues.interactiveSegState)
          state.cropperState = castDraft(defaultValues.cropperState)
          state.extenderState = castDraft(defaultValues.extenderState)
          state.isCropperExtenderResizing = false
          state.generatedImages = []
          state.selectedGeneratedImageIndex = 0
          state.pendingGeneratedHandoff = false
          state.showReplaceImageConfirm = false
          state.pendingReplaceImage = null
          state.pendingReplaceTab = null
          state.workingImage = null
          state.currentWorkspaceSessionId = null
          state.workspaceDetail = null
          state.workspaceDirty = false
        })
      },

      requestReplaceImage: async (file, tab) => {
        if (get().hasSavableWorkspaceContent() && get().hasUnsavedWorkspaceChanges()) {
          set((state) => {
            state.pendingReplaceImage = file
            state.pendingReplaceTab = tab
            state.showReplaceImageConfirm = true
          })
          return
        }

        get().resetWorkspaceForNewGeneration()
        await get().loadImageForTab(file, tab)
      },

      confirmReplaceImageWithSave: async () => {
        const pendingFile = get().pendingReplaceImage
        const pendingTab = get().pendingReplaceTab
        if (!pendingFile || pendingTab === null) {
          get().cancelReplaceImage()
          return
        }

        const saved = await get().saveWorkspace()
        if (!saved) {
          return
        }

        get().resetWorkspaceForNewGeneration()
        await get().loadImageForTab(pendingFile, pendingTab)
      },

      confirmReplaceImageWithoutSave: async () => {
        const pendingFile = get().pendingReplaceImage
        const pendingTab = get().pendingReplaceTab
        if (!pendingFile || pendingTab === null) {
          get().cancelReplaceImage()
          return
        }

        get().resetWorkspaceForNewGeneration()
        await get().loadImageForTab(pendingFile, pendingTab)
      },

      cancelReplaceImage: () => {
        set((state) => {
          state.showReplaceImageConfirm = false
          state.pendingReplaceImage = null
          state.pendingReplaceTab = null
        })
      },

      sendToTab: async (blobUrl: string, tab: WorkspaceTab) => {
        try {
          const res = await fetch(blobUrl)
          const blob = await res.blob()
          const file = new File([blob], "generated.png", {
            type: blob.type || "image/png",
          })
          await get().loadImageForTab(file, tab)
          get().setActiveTab(tab)
        } catch (e) {
          console.error("sendToTab failed:", e)
        }
      },

      setWorkingImage: (file: File) => {
        set((state) => {
          revokeImageRef(state.workingImage)
          state.workingImage = castDraft(makeImageRef(file))
        })
      },

      loadImageForTab: async (file: File, tab: WorkspaceTab) => {
        if (
          tab === WorkspaceTab.REMOVE_BG ||
          tab === WorkspaceTab.SUPER_RES ||
          tab === WorkspaceTab.FACE_RESTORE
        ) {
          get().setFeatureSourceImage(tab, file)
          get().setWorkingImage(file)
          return
        }

        await get().setFile(file)
        get().setWorkingImage(file)
      },

      undoFeatureResultDisabled: (tab) => {
        const target =
          tab === WorkspaceTab.REMOVE_BG
            ? get().removeBgState
            : tab === WorkspaceTab.SUPER_RES
            ? get().superResState
            : get().faceRestoreState

        return target.resultHistoryIndex < 0
      },

      redoFeatureResultDisabled: (tab) => {
        const target =
          tab === WorkspaceTab.REMOVE_BG
            ? get().removeBgState
            : tab === WorkspaceTab.SUPER_RES
            ? get().superResState
            : get().faceRestoreState

        return target.resultHistoryIndex >= target.resultHistory.length - 1
      },

      undoFeatureResult: (tab) => {
        set((state) => {
          const target =
            tab === WorkspaceTab.REMOVE_BG
              ? state.removeBgState
              : tab === WorkspaceTab.SUPER_RES
              ? state.superResState
              : state.faceRestoreState

          if (target.resultHistoryIndex < 0) {
            return
          }

          target.resultHistoryIndex -= 1
          syncFeatureResultImage(target)
        })
      },

      redoFeatureResult: (tab) => {
        set((state) => {
          const target =
            tab === WorkspaceTab.REMOVE_BG
              ? state.removeBgState
              : tab === WorkspaceTab.SUPER_RES
              ? state.superResState
              : state.faceRestoreState

          if (target.resultHistoryIndex >= target.resultHistory.length - 1) {
            return
          }

          target.resultHistoryIndex += 1
          syncFeatureResultImage(target)
        })
      },

      setFeatureSourceImage: (tab, file) => {
        set((state) => {
          const next = makeImageRef(file)
          if (tab === WorkspaceTab.REMOVE_BG) {
            revokeImageRef(state.removeBgState.sourceImage)
            state.removeBgState.sourceImage = castDraft(next)
            clearFeatureResultHistory(state.removeBgState)
          } else if (tab === WorkspaceTab.SUPER_RES) {
            revokeImageRef(state.superResState.sourceImage)
            state.superResState.sourceImage = castDraft(next)
            clearFeatureResultHistory(state.superResState)
          } else {
            revokeImageRef(state.faceRestoreState.sourceImage)
            state.faceRestoreState.sourceImage = castDraft(next)
            clearFeatureResultHistory(state.faceRestoreState)
          }
          state.workspaceDirty = true
        })
      },

      setFeatureResultImage: (tab, file) => {
        set((state) => {
          const target =
            tab === WorkspaceTab.REMOVE_BG
              ? state.removeBgState
              : tab === WorkspaceTab.SUPER_RES
              ? state.superResState
              : state.faceRestoreState

          if (!file) {
            clearFeatureResultHistory(target)
            state.workspaceDirty = true
            return
          }

          pushFeatureResultHistory(target, file)
          state.workspaceDirty = true
        })
      },

      setFeatureSelectedModel: (tab, value) => {
        set((state) => {
          if (tab === WorkspaceTab.REMOVE_BG) {
            state.removeBgState.selectedModel = value
          } else if (tab === WorkspaceTab.SUPER_RES) {
            state.superResState.selectedModel = value
          } else {
            state.faceRestoreState.selectedPlugin = value
          }
          state.workspaceDirty = true
        })
      },

      clearCurrentWorkspace: () => {
        set((state) => {
          state.currentWorkspaceSessionId = null
          state.workspaceDetail = null
        })
      },

      runTxt2Img: async () => {
        const { settings, serverConfig, currentWorkspaceSessionId } = get()
        let selectedModel = settings.model
        if (!selectedModel.support_txt2img) {
          const fallback = serverConfig.modelInfos.find((m) => m.support_txt2img)
          if (!fallback) {
            toast({
              variant: "destructive",
              title: "Generation failed",
              description: "No text-to-image model is available on this server.",
            })
            return
          }
          selectedModel = fallback
          get().updateSettings({ model: fallback }, { markDirty: false })
        }

        set((state) => {
          state.isGenerating = true
          state.isCancelingTask = false
        })

        try {
          const result = await txt2img({
            prompt: settings.prompt,
            negativePrompt: settings.negativePrompt,
            modelName: selectedModel.name,
            width: settings.txt2imgWidth,
            height: settings.txt2imgHeight,
            steps: settings.sdSteps,
            guidanceScale: settings.sdGuidanceScale,
            sampler: settings.sdSampler,
            sessionId: currentWorkspaceSessionId ?? undefined,
            seed: settings.seed,
            seedFixed: settings.seedFixed,
            enableLCMLora: settings.enableLCMLora,
          })
          if (result) {
            const response = await fetch(result.blob)
            const blob = await response.blob()
            const file = new File([blob], "generated.png", {
              type: blob.type || "image/png",
            })

            set((state) => {
              state.generatedImages.unshift({
                url: result.blob,
                seed: result.seed ?? "0",
                file,
              })
              state.selectedGeneratedImageIndex = 0
              state.pendingGeneratedHandoff = true
              state.workspaceDirty = true
            })
            get().setWorkingImage(file)
          }
        } catch (e: any) {
          toast({
            variant: "destructive",
            title: "Generation failed",
            description: e.message ? e.message : e.toString(),
          })
        } finally {
          set((state) => {
            state.isGenerating = false
            state.isCancelingTask = false
          })
        }
      },

      saveWorkspace: async () => {
        if (!get().isAuthenticated) {
          toast({
            variant: "destructive",
            description: "请先登录后再保存到“我的作品”。",
          })
          return false
        }

        set((state) => {
          state.isSavingWorkspace = true
        })

        try {
          const state = get()
          const assets: Array<{
            role: string
            kind: string
            data: string
            filename?: string
            label?: string
            mime_type?: string
            width?: number
            height?: number
            metadata?: Record<string, any>
          }> = []

          const pushFileAsset = async (
            file: File,
            role: string,
            kind: string,
            label?: string
          ) => {
            assets.push({
              role,
              kind,
              data: await convertToBase64(file),
              filename: file.name,
              label,
              mime_type: file.type,
            })
          }

          const pushFeatureAssets = async (
            featureState: FeatureResultState,
            tab: FeatureResultTab
          ): Promise<boolean> => {
            const primary = featureState.resultImage ?? featureState.sourceImage
            if (!primary) {
              return false
            }
            if (featureState.sourceImage) {
              await pushFileAsset(
                featureState.sourceImage.file,
                "source",
                "uploaded",
                "source"
              )
            }
            if (featureState.resultImage) {
              await pushFileAsset(
                featureState.resultImage.file,
                "result",
                tab,
                "result"
              )
            }
            await pushFileAsset(primary.file, "primary", tab, "primary")
            await pushFileAsset(primary.file, "preview", "preview", "preview")
            return true
          }

          const pushGenerateFallbackAssets = async (): Promise<boolean> => {
            if (
              await pushFeatureAssets(
                state.removeBgState,
                WorkspaceTab.REMOVE_BG
              )
            ) {
              return true
            }
            if (
              await pushFeatureAssets(
                state.superResState,
                WorkspaceTab.SUPER_RES
              )
            ) {
              return true
            }
            if (
              await pushFeatureAssets(
                state.faceRestoreState,
                WorkspaceTab.FACE_RESTORE
              )
            ) {
              return true
            }

            const primaryFile =
              state.workingImage?.file ??
              (state.file ? await state.getCurrentTargetFile() : null)
            if (!primaryFile) {
              return false
            }

            if (state.file) {
              await pushFileAsset(state.file, "source", "uploaded", "source")
            }
            await pushFileAsset(primaryFile, "primary", "uploaded", "primary")
            await pushFileAsset(primaryFile, "preview", "preview", "preview")
            return true
          }

          const activeTab = state.activeTab
          const workspaceState: Record<string, any> = {
            cropperState: state.cropperState,
            extenderState: state.extenderState,
            selectedGeneratedImageIndex: state.selectedGeneratedImageIndex,
            removeBgState: {
              selectedModel: state.removeBgState.selectedModel,
            },
            superResState: {
              selectedModel: state.superResState.selectedModel,
            },
            faceRestoreState: {
              selectedPlugin: state.faceRestoreState.selectedPlugin,
            },
          }

          if (activeTab === WorkspaceTab.GENERATE) {
            const selected =
              state.generatedImages[state.selectedGeneratedImageIndex] ??
              state.generatedImages[0]
            if (!selected) {
              const hasFallback = await pushGenerateFallbackAssets()
              if (!hasFallback) {
                throw new Error("当前没有可保存的图片")
              }
            } else {
              const file =
                selected.file ??
                (await (async () => {
                  const res = await fetch(selected.url)
                  const blob = await res.blob()
                  return new File([blob], "generated.png", {
                    type: blob.type || "image/png",
                  })
                })())
              await pushFileAsset(file, "primary", "generated", "generated")
              await pushFileAsset(file, "preview", "preview", "preview")
            }
          } else if (
            activeTab === WorkspaceTab.INPAINT ||
            activeTab === WorkspaceTab.OUTPAINT ||
            activeTab === WorkspaceTab.AI_REPAINT ||
            activeTab === WorkspaceTab.INTERACTIVE_SEG
          ) {
            const primaryFile = await state.getCurrentTargetFile()
            await pushFileAsset(primaryFile, "primary", activeTab, activeTab)
            await pushFileAsset(primaryFile, "preview", "preview", "preview")
            if (state.file) {
              await pushFileAsset(state.file, "source", "uploaded", "source")
            }
            const hasMask =
              state.editorState.curLineGroup.length > 0 ||
              state.editorState.extraMasks.length > 0
            if (hasMask) {
              const maskCanvas = generateMask(
                state.imageWidth,
                state.imageHeight,
                [state.editorState.curLineGroup],
                state.editorState.extraMasks,
                BRUSH_COLOR
              )
              const maskBlob = dataURItoBlob(maskCanvas.toDataURL())
              const maskFile = new File([maskBlob], "mask.png", { type: "image/png" })
              await pushFileAsset(maskFile, "mask", "mask", "mask")
            }
          } else {
            const featureTab: FeatureResultTab =
              activeTab === WorkspaceTab.REMOVE_BG
                ? WorkspaceTab.REMOVE_BG
                : activeTab === WorkspaceTab.SUPER_RES
                ? WorkspaceTab.SUPER_RES
                : WorkspaceTab.FACE_RESTORE
            const featureState =
              featureTab === WorkspaceTab.REMOVE_BG
                ? state.removeBgState
                : featureTab === WorkspaceTab.SUPER_RES
                ? state.superResState
                : state.faceRestoreState
            const hasFeatureAssets = await pushFeatureAssets(
              featureState,
              featureTab
            )
            if (!hasFeatureAssets) {
              throw new Error("当前没有可保存的图片")
            }
          }

          const buildSavePayload = (sessionId?: string | null) => ({
            session_id: sessionId,
            active_tab: activeTab,
            settings_by_feature: state.settingsByFeature,
            workspace_state: workspaceState,
            assets,
          })

          let detail: WorkspaceDetail
          try {
            detail = await saveWorkspaceApi(
              buildSavePayload(state.currentWorkspaceSessionId)
            )
          } catch (e: any) {
            const missingSession =
              axios.isAxiosError(e) &&
              e.response?.status === 404 &&
              state.currentWorkspaceSessionId
            if (!missingSession) {
              throw e
            }

            set((draft) => {
              draft.currentWorkspaceSessionId = null
              draft.workspaceDetail = null
            })

            detail = await saveWorkspaceApi(buildSavePayload(null))
          }

          set((draft) => {
            draft.currentWorkspaceSessionId = detail.session.id
            draft.workspaceDetail = detail
            draft.workspaceDirty = false
          })
          await get().fetchWorkspaces()
          toast({
            description: "已保存到“我的作品”。",
          })
          return true
        } catch (e: any) {
          toast({
            variant: "destructive",
            description: e.message ? e.message : e.toString(),
          })
          return false
        } finally {
          set((state) => {
            state.isSavingWorkspace = false
          })
        }
      },

      fetchWorkspaces: async (search?: string, feature?: string) => {
        if (!get().isAuthenticated) return
        set((state) => {
          state.isLoadingWorkspaces = true
        })
        try {
          const items = await listWorkspaces(search, feature)
          set((state) => {
            state.workspaceItems = items
          })
        } finally {
          set((state) => {
            state.isLoadingWorkspaces = false
          })
        }
      },

      fetchWorkspaceDetail: async (id: string) => {
        if (!get().isAuthenticated) return
        set((state) => {
          state.isLoadingWorkspaceDetail = true
        })
        try {
          const detail = await getWorkspaceDetail(id)
          set((state) => {
            state.workspaceDetail = detail
          })
        } finally {
          set((state) => {
            state.isLoadingWorkspaceDetail = false
          })
        }
      },

      resumeWorkspace: async (id: string) => {
        const payload: WorkspaceResumePayload = await resumeWorkspaceApi(id)
        const roleMap = payload.snapshot.asset_roles || {}
        const loadAssetFile = async (assetId?: string) => {
          if (!assetId) return null
          const res = await fetch(getAssetFileUrl(assetId))
          const blob = await res.blob()
          const type = res.headers.get("Content-Type") || "image/png"
          return new File([blob], `${assetId}.${type.split("/")[1] || "png"}`, {
            type,
          })
        }

        const primaryFile = await loadAssetFile(roleMap.primary)
        const sourceFile = await loadAssetFile(roleMap.source)
        const resultFile = await loadAssetFile(roleMap.result)
        const maskFile = await loadAssetFile(roleMap.mask)
        const targetTab = payload.snapshot.active_tab as WorkspaceTab

        set((state) => {
          state.currentWorkspaceSessionId = payload.session.id
          state.workspaceDetail = {
            session: payload.session,
            latest_snapshot: payload.snapshot,
            feature_states: payload.feature_states,
            operations: [],
          }
          state.generatedImages = []
          state.selectedGeneratedImageIndex = 0
          state.pendingGeneratedHandoff = false
          state.removeBgState = castDraft(createEmptyFeatureResultState())
          state.superResState = castDraft(createEmptyFeatureResultState())
          state.faceRestoreState = castDraft(createEmptyFeatureResultState())
          state.editorState = castDraft(defaultValues.editorState)
          state.cropperState = castDraft(
            payload.snapshot.workspace_state.cropperState ?? defaultValues.cropperState
          )
          state.extenderState = castDraft(
            payload.snapshot.workspace_state.extenderState ?? defaultValues.extenderState
          )
        })

        set((state) => {
          const merged = createDefaultSettingsByFeature()
          for (const [key, value] of Object.entries(payload.feature_states || {})) {
            if (merged[key as WorkspaceTab]) {
              merged[key as WorkspaceTab] = {
                ...merged[key as WorkspaceTab],
                ...(value as Settings),
              }
            }
          }
          state.settingsByFeature = castDraft(merged)
          state.settings = castDraft(cloneSettings(merged[targetTab]))
        })

        if (
          targetTab === WorkspaceTab.INPAINT ||
          targetTab === WorkspaceTab.OUTPAINT ||
          targetTab === WorkspaceTab.AI_REPAINT ||
          targetTab === WorkspaceTab.INTERACTIVE_SEG
        ) {
          const file = primaryFile ?? sourceFile
          if (file) {
            await get().setFile(file)
            get().setWorkingImage(file)
          }
          if (maskFile) {
            const img = await blobToImage(maskFile)
            set((state) => {
              state.editorState.extraMasks = [castDraft(img)]
            })
          }
        } else if (targetTab === WorkspaceTab.GENERATE) {
          const file = primaryFile ?? sourceFile
          if (file) {
            const imageRef = makeImageRef(file)
            set((state) => {
              state.generatedImages = [{ url: imageRef.url, seed: "", file }]
              state.selectedGeneratedImageIndex = 0
              state.pendingGeneratedHandoff = false
              revokeImageRef(state.workingImage)
              state.workingImage = castDraft(imageRef)
              state.file = null
            })
          }
        } else if (targetTab === WorkspaceTab.REMOVE_BG) {
          if (sourceFile ?? primaryFile) {
            get().setFeatureSourceImage(
              WorkspaceTab.REMOVE_BG,
              (sourceFile ?? primaryFile)!
            )
          }
          if (resultFile) get().setFeatureResultImage(WorkspaceTab.REMOVE_BG, resultFile)
        } else if (targetTab === WorkspaceTab.SUPER_RES) {
          if (sourceFile ?? primaryFile) {
            get().setFeatureSourceImage(
              WorkspaceTab.SUPER_RES,
              (sourceFile ?? primaryFile)!
            )
          }
          if (resultFile) get().setFeatureResultImage(WorkspaceTab.SUPER_RES, resultFile)
        } else if (targetTab === WorkspaceTab.FACE_RESTORE) {
          if (sourceFile ?? primaryFile) {
            get().setFeatureSourceImage(
              WorkspaceTab.FACE_RESTORE,
              (sourceFile ?? primaryFile)!
            )
          }
          if (resultFile) get().setFeatureResultImage(WorkspaceTab.FACE_RESTORE, resultFile)
        }

        const savedWorkspaceState = payload.snapshot.workspace_state || {}
        if (savedWorkspaceState.removeBgState?.selectedModel) {
          get().setFeatureSelectedModel(
            WorkspaceTab.REMOVE_BG,
            savedWorkspaceState.removeBgState.selectedModel
          )
        }
        if (savedWorkspaceState.superResState?.selectedModel) {
          get().setFeatureSelectedModel(
            WorkspaceTab.SUPER_RES,
            savedWorkspaceState.superResState.selectedModel
          )
        }
        if (savedWorkspaceState.faceRestoreState?.selectedPlugin) {
          get().setFeatureSelectedModel(
            WorkspaceTab.FACE_RESTORE,
            savedWorkspaceState.faceRestoreState.selectedPlugin
          )
        }

        get().setActiveTab(targetTab)
        get().resetWorkspaceDirty()
      },

      importFileToWorkspace: async (file: File, title?: string) => {
        const imported = await importWorkspaceFile(file, title)
        await get().resumeWorkspace(imported.session_id)
      },

      deleteWorkspaceItem: async (id: string) => {
        await deleteWorkspace(id)
        set((state) => {
          state.workspaceItems = state.workspaceItems.filter((item) => item.id !== id)
          if (state.workspaceDetail?.session.id === id) {
            state.workspaceDetail = null
          }
          if (state.currentWorkspaceSessionId === id) {
            state.currentWorkspaceSessionId = null
          }
        })
      },

      cancelCurrentTask: async () => {
        const { isInpainting, isGenerating, isCancelingTask } = get()
        if ((!isInpainting && !isGenerating) || isCancelingTask) {
          return
        }
        set((state) => {
          state.isCancelingTask = true
        })
        try {
          const res = await cancelCurrentTaskApi()
          if (res.cancel_requested) {
            toast({
              description: `Cancel request sent (${res.task ?? "task"})`,
            })
          } else {
            toast({
              description: "No running task to cancel.",
            })
            set((state) => {
              state.isCancelingTask = false
            })
          }
        } catch (e: any) {
          toast({
            variant: "destructive",
            title: "Cancel failed",
            description: e.message ? e.message : e.toString(),
          })
          set((state) => {
            state.isCancelingTask = false
          })
        }
      },
      // ------------------------------------------------------------------
      // Auth actions
      // ------------------------------------------------------------------

      login: async (username: string, password: string) => {
        const data = await authLogin(username, password)
        setAuthToken(data.access_token)
        const user = await authMe()
        set((state) => {
          state.token = data.access_token
          state.user = user
          state.isAuthenticated = true
        })
        await get().fetchWorkspaces()
      },

      register: async (username: string, email: string, password: string) => {
        await authRegister(username, email, password)
        // Auto-login after registration
        await get().login(username, password)
      },

      logout: () => {
        setAuthToken(null)
        set((state) => {
          state.token = null
          state.user = null
          state.isAuthenticated = false
          state.workspaceItems = []
          state.workspaceDetail = null
          state.currentWorkspaceSessionId = null
          state.workspaceDirty = false
        })
      },

      restoreSession: async () => {
        const token = get().token
        if (!token) return
        try {
          setAuthToken(token)
          const user = await authMe()
          set((state) => {
            state.user = user
            state.isAuthenticated = true
          })
          await get().fetchWorkspaces()
        } catch {
          get().logout()
        }
      },
    })),
    {
      name: "ZUSTAND_STATE",
      version: 6,
      migrate: (persistedState: any, version: number) => {
        if (version < 4) {
          // Add txt2imgWidth/txt2imgHeight defaults if missing
          if (persistedState.settings) {
            if (persistedState.settings.txt2imgWidth === undefined) {
              persistedState.settings.txt2imgWidth = 512
            }
            if (persistedState.settings.txt2imgHeight === undefined) {
              persistedState.settings.txt2imgHeight = 512
            }
          }
          // Remove legacy workspaceMode
          delete persistedState.workspaceMode
        }
        if (version < 5) {
          // Feature settings are session-only from v5 onward.
          delete persistedState.settings
          delete persistedState.settingsByFeature
          delete persistedState.activeTab
        }
        if (version < 6) {
          delete persistedState.projects
          delete persistedState.currentProject
          delete persistedState.projectImages
          delete persistedState.workspaceItems
          delete persistedState.workspaceDetail
          delete persistedState.currentWorkspaceSessionId
        }
        return persistedState
      },
      partialize: (state) =>
        Object.fromEntries(
          Object.entries(state).filter(([key]) =>
            ["fileManagerState", "token"].includes(key)
          )
        ),
    }
  ),
  shallow
)
