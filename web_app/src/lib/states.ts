import { persist } from "zustand/middleware"
import { shallow } from "zustand/shallow"
import { immer } from "zustand/middleware/immer"
import { castDraft } from "immer"
import { createWithEqualityFn } from "zustand/traditional"
import {
  AdjustMaskOperate,
  CV2Flag,
  ExtenderDirection,
  ImageInfo,
  LDMSampler,
  Line,
  LineGroup,
  ModelInfo,
  PluginParams,
  Point,
  PowerPaintTask,
  ProjectInfo,
  ServerConfig,
  Size,
  SortBy,
  SortOrder,
  UserInfo,
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
  createProject,
  deleteImage,
  deleteProject,
  getGenInfo,
  getImages,
  getProjects,
  postAdjustMask,
  runPlugin,
  setAuthToken,
  txt2img,
} from "./api"
import { toast } from "@/components/ui/use-toast"

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
  generatedImages: Array<{ url: string; seed: string }>
  isGenerating: boolean
  isCancelingTask: boolean
  // 全局工作图片，所有标签页共享
  workingImage: { file: File; url: string } | null

  // Auth state
  user: UserInfo | null
  token: string | null
  isAuthenticated: boolean

  // User data
  projects: ProjectInfo[]
  currentProject: ProjectInfo | null
  projectImages: ImageInfo[]
  isLoadingProjects: boolean
  isLoadingImages: boolean
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
  updateExtenderDirection: (newValue: ExtenderDirection) => void
  resetExtender: (width: number, height: number) => void
  updateExtenderByBuiltIn: (direction: ExtenderDirection, scale: number) => void

  setServerConfig: (newValue: ServerConfig) => void
  setSeed: (newValue: number) => void
  updateSettings: (newSettings: Partial<Settings>) => void

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

  // Auth actions
  login: (username: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
  logout: () => void
  restoreSession: () => Promise<void>

  // User data actions
  fetchProjects: () => Promise<void>
  createUserProject: (name: string, description?: string) => Promise<void>
  deleteUserProject: (id: string) => Promise<void>
  setCurrentProject: (project: ProjectInfo | null) => void
  fetchProjectImages: (projectId?: string, imageType?: string) => Promise<void>
  deleteUserImage: (id: string) => Promise<void>
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
      sdSteps: 30,
      sdGuidanceScale: 10.0,
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
  isGenerating: false,
  isCancelingTask: false,
  workingImage: null,

  user: null,
  token: null,
  isAuthenticated: false,

  projects: [],
  currentProject: null,
  projectImages: [],
  isLoadingProjects: false,
  isLoadingImages: false,
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
              get().updateSettings({ model: fixedModelInfo })
            }
          }

          const res = await inpaint(
            targetFile,
            settings,
            inpaintTaskType,
            cropperState,
            extenderState,
            dataURItoBlob(maskCanvas.toDataURL()),
            paintByExampleFile
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
            params.upscale
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

      updateSettings: (newSettings: Partial<Settings>) => {
        set((state) => {
          const merged = {
            ...state.settings,
            ...newSettings,
          }
          state.settings = merged
          state.settingsByFeature[state.activeTab] = castDraft(
            cloneSettings(merged)
          )
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
        if (
          get().settings.enableAutoExtractPrompt &&
          autoPromptTabs.includes(get().activeTab)
        ) {
          try {
            const res = await getGenInfo(file)
            if (res.prompt) {
              get().updateSettings({ prompt: res.prompt })
            }
            if (res.negative_prompt) {
              get().updateSettings({ negativePrompt: res.negative_prompt })
            }
          } catch (e: any) {
            toast({
              variant: "destructive",
              description: e.message ? e.message : e.toString(),
            })
          }
        }
        set((state) => {
          state.file = file
          state.interactiveSegState = castDraft(
            defaultValues.interactiveSegState
          )
          state.editorState = castDraft(defaultValues.editorState)
          state.cropperState = defaultValues.cropperState
        })
      },

      setCustomFile: (file: File) =>
        set((state) => {
          state.customMask = file
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

      updateExtenderDirection: (newValue: ExtenderDirection) => {
        console.log(
          `updateExtenderDirection: ${JSON.stringify(get().extenderState)}`
        )
        set((state) => {
          state.settings.extenderDirection = newValue
          state.extenderState.x = 0
          state.extenderState.y = 0
          state.extenderState.width = state.imageWidth
          state.extenderState.height = state.imageHeight
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
        })

        set((state) => {
          state.isAdjustingMask = false
        })
      },
      clearMask: () => {
        set((state) => {
          state.editorState.extraMasks = []
          state.editorState.curLineGroup = []
        })
      },

      setActiveTab: (tab: WorkspaceTab) => {
        const prevTab = get().activeTab
        const EDITOR_TABS = [
          WorkspaceTab.INPAINT,
          WorkspaceTab.OUTPAINT,
          WorkspaceTab.AI_REPAINT,
          WorkspaceTab.INTERACTIVE_SEG,
        ]

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

        set((state) => {
          state.settingsByFeature[prevTab] = castDraft(
            cloneSettings(state.settings)
          )
          state.activeTab = tab
        })

        // 进入画布标签页时，如果 workingImage 存在且 file 为空，自动加载
        if (EDITOR_TABS.includes(tab)) {
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
          state.generatedImages = []
        })
      },

      sendToTab: async (blobUrl: string, tab: WorkspaceTab) => {
        try {
          const res = await fetch(blobUrl)
          const blob = await res.blob()
          const file = new File([blob], "generated.png", { type: "image/png" })
          const url = URL.createObjectURL(file)
          const old = get().workingImage
          if (old?.url) URL.revokeObjectURL(old.url)
          set((state) => {
            state.workingImage = castDraft({ file, url })
          })
          get().setActiveTab(tab)  // 使用 setActiveTab 而非直接设置，确保 tab 上下文逻辑执行
        } catch (e) {
          console.error("sendToTab failed:", e)
        }
      },

      setWorkingImage: (file: File) => {
        const url = URL.createObjectURL(file)
        const old = get().workingImage
        if (old?.url) URL.revokeObjectURL(old.url)
        set((state) => {
          state.workingImage = castDraft({ file, url })
        })
      },

      runTxt2Img: async () => {
        const { settings, serverConfig } = get()
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
          get().updateSettings({ model: fallback })
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
            seed: settings.seed,
            seedFixed: settings.seedFixed,
            enableLCMLora: settings.enableLCMLora,
          })
          if (result) {
            set((state) => {
              state.generatedImages.unshift({
                url: result.blob,
                seed: result.seed ?? "0",
              })
            })
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
          state.projects = []
          state.currentProject = null
          state.projectImages = []
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
        } catch {
          get().logout()
        }
      },

      // ------------------------------------------------------------------
      // User data actions
      // ------------------------------------------------------------------

      fetchProjects: async () => {
        if (!get().isAuthenticated) return
        set((state) => { state.isLoadingProjects = true })
        try {
          const projects = await getProjects()
          set((state) => { state.projects = projects })
        } catch {
          // silently ignore
        } finally {
          set((state) => { state.isLoadingProjects = false })
        }
      },

      createUserProject: async (name: string, description = "") => {
        const project = await createProject(name, description)
        set((state) => {
          state.projects.unshift(project)
        })
      },

      deleteUserProject: async (id: string) => {
        await deleteProject(id)
        set((state) => {
          state.projects = state.projects.filter((p) => p.id !== id)
          if (state.currentProject?.id === id) {
            state.currentProject = null
            state.projectImages = []
          }
        })
      },

      setCurrentProject: (project: ProjectInfo | null) => {
        set((state) => { state.currentProject = project })
        if (project) {
          get().fetchProjectImages(project.id)
        }
      },

      fetchProjectImages: async (projectId?: string, imageType?: string) => {
        if (!get().isAuthenticated) return
        set((state) => { state.isLoadingImages = true })
        try {
          const images = await getImages(projectId, imageType)
          set((state) => { state.projectImages = images })
        } catch {
          // silently ignore
        } finally {
          set((state) => { state.isLoadingImages = false })
        }
      },

      deleteUserImage: async (id: string) => {
        await deleteImage(id)
        set((state) => {
          state.projectImages = state.projectImages.filter((img) => img.id !== id)
        })
      },
    })),
    {
      name: "ZUSTAND_STATE",
      version: 5,
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
