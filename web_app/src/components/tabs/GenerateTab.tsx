import { FormEvent, useCallback, useEffect, useRef, useState } from "react"
import { useStore } from "@/lib/states"
import { Button } from "../ui/button"
import { Textarea } from "../ui/textarea"
import { Slider } from "../ui/slider"
import { Label } from "../ui/label"
import { WorkspaceTab } from "@/lib/types"
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  Loader2,
  Trash2,
  Wand2,
  Edit2,
  Zap,
  Scissors,
  Smile,
  Download,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select"
import {
  MODEL_TYPE_DIFFUSERS_SD,
  MODEL_TYPE_DIFFUSERS_SD_INPAINT,
  MODEL_TYPE_DIFFUSERS_SDXL,
  MODEL_TYPE_DIFFUSERS_SDXL_INPAINT,
  RECOMMENDED_MODELS,
  RESOLUTION_PRESETS,
} from "@/lib/const"
import { switchModel, switchTab } from "@/lib/api"
import { PluginName } from "@/lib/types"

const SDXL_TYPES = [MODEL_TYPE_DIFFUSERS_SDXL, MODEL_TYPE_DIFFUSERS_SDXL_INPAINT]
const SD_TYPES = [MODEL_TYPE_DIFFUSERS_SD, MODEL_TYPE_DIFFUSERS_SD_INPAINT]

const GenerateTab = () => {
  const [
    settings,
    serverConfig,
    generatedImages,
    isGenerating,
    updateSettings,
    runTxt2Img,
    clearGeneratedImages,
    sendToTab,
  ] = useStore((state) => [
    state.settings,
    state.serverConfig,
    state.generatedImages,
    state.isGenerating,
    state.updateSettings,
    state.runTxt2Img,
    state.clearGeneratedImages,
    state.sendToTab,
  ])

  const promptRef = useRef<HTMLTextAreaElement>(null)
  const [isSwitchingModel, setIsSwitchingModel] = useState(false)
  const [showRecommended, setShowRecommended] = useState(false)

  // 挂载时确保后端模型支持 txt2img（应对页面刷新后直接进入此 tab 的场景）
  useEffect(() => {
    if (!settings.model.support_txt2img) {
      setIsSwitchingModel(true)
      switchTab("generate")
        .then((newModel) => updateSettings({ model: newModel }))
        .catch(console.error)
        .finally(() => setIsSwitchingModel(false))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isDisabled = isGenerating || isSwitchingModel

  // Auto-update resolution when model type changes between SD and SDXL
  const prevModelTypeRef = useRef(settings.model.model_type)
  // Only re-run when model type changes; width/height/updateSettings are intentionally omitted
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const prev = prevModelTypeRef.current
    const curr = settings.model.model_type
    if (prev === curr) return
    prevModelTypeRef.current = curr

    const wasSD = SD_TYPES.includes(prev)
    const isNowSDXL = SDXL_TYPES.includes(curr)
    const wasSDXL = SDXL_TYPES.includes(prev)
    const isNowSD = SD_TYPES.includes(curr)

    if (wasSD && isNowSDXL && settings.txt2imgWidth <= 768) {
      updateSettings({ txt2imgWidth: 1024, txt2imgHeight: 1024 })
    } else if (wasSDXL && isNowSD && settings.txt2imgWidth >= 1024) {
      updateSettings({ txt2imgWidth: 512, txt2imgHeight: 512 })
    }
  }, [settings.model.model_type])

  const handleGenerate = useCallback(() => {
    if (!isDisabled && settings.prompt.trim()) {
      runTxt2Img()
    }
  }, [isDisabled, settings.prompt, runTxt2Img])

  const handleEditImage = async (url: string) => {
    await sendToTab(url, WorkspaceTab.INPAINT)
  }

  const handleSwitchModel = async (name: string) => {
    if (isSwitchingModel || isGenerating) return
    setIsSwitchingModel(true)
    try {
      const newModel = await switchModel(name)
      updateSettings({ model: newModel })
    } catch (e) {
      console.error("Failed to switch model:", e)
    } finally {
      setIsSwitchingModel(false)
    }
  }

  const handleSwapResolution = () => {
    updateSettings({
      txt2imgWidth: settings.txt2imgHeight,
      txt2imgHeight: settings.txt2imgWidth,
    })
  }

  const samplers = serverConfig.samplers
  const modelType = settings.model.model_type
  const isSDXL = SDXL_TYPES.includes(modelType)
  const showLowResWarning = isSDXL && settings.txt2imgWidth < 768 && settings.txt2imgHeight < 768


  // Resolution presets filtered to current model type
  const availablePresets = RESOLUTION_PRESETS.filter((p) =>
    p.modelTypes.includes(modelType)
  )

  // Current resolution as preset label (for display)
  const currentPresetLabel =
    availablePresets.find(
      (p) => p.width === settings.txt2imgWidth && p.height === settings.txt2imgHeight
    )?.label ?? "自定义"

  // Downloaded model names for recommended section
  const downloadedNames = new Set(serverConfig.modelInfos.map((m) => m.name))

  const hasRemoveBG = serverConfig.plugins.some((p) => p.name === PluginName.RemoveBG)
  const hasRealESRGAN = serverConfig.plugins.some((p) => p.name === PluginName.RealESRGAN)
  const hasFaceRestore = serverConfig.plugins.some(
    (p) => p.name === PluginName.GFPGAN || p.name === PluginName.RestoreFormer
  )

  const handleDownloadImage = (url: string, idx: number) => {
    const a = document.createElement("a")
    a.href = url
    a.download = `generated_${idx + 1}.png`
    a.click()
  }

  return (
    <div className="flex flex-col h-full w-full max-w-3xl mx-auto px-6 py-6 gap-5">
      {/* Model display */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">当前模型:</span>
        {isSwitchingModel ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            切换中…
          </span>
        ) : (
          <span className="text-xs font-medium truncate max-w-[240px]" title={settings.model.name}>
            {settings.model.name.split("/").pop()}
          </span>
        )}
      </div>

      {/* Prompt inputs */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gen-prompt">Prompt</Label>
          <Textarea
            id="gen-prompt"
            ref={promptRef}
            placeholder="描述你想要生成的图像…"
            className="min-h-[80px] resize-none"
            value={settings.prompt}
            disabled={isDisabled}
            onInput={(e: FormEvent<HTMLTextAreaElement>) => {
              updateSettings({ prompt: (e.target as HTMLTextAreaElement).value })
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.ctrlKey) {
                e.preventDefault()
                handleGenerate()
              }
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gen-neg-prompt" className="text-muted-foreground">
            Negative Prompt
          </Label>
          <Textarea
            id="gen-neg-prompt"
            placeholder="需要避免的内容…"
            className="min-h-[60px] resize-none text-sm"
            value={settings.negativePrompt}
            disabled={isDisabled}
            onInput={(e: FormEvent<HTMLTextAreaElement>) => {
              updateSettings({
                negativePrompt: (e.target as HTMLTextAreaElement).value,
              })
            }}
          />
        </div>
      </div>

      {/* Resolution */}
      <div className="flex flex-col gap-2">
        <Label>分辨率</Label>
        <div className="flex gap-2 items-center">
          {/* Preset dropdown */}
          {availablePresets.length > 0 && (
            <Select
              value={currentPresetLabel}
              onValueChange={(label) => {
                const preset = availablePresets.find((p) => p.label === label)
                if (preset) {
                  updateSettings({
                    txt2imgWidth: preset.width,
                    txt2imgHeight: preset.height,
                  })
                }
              }}
              disabled={isDisabled}
            >
              <SelectTrigger className="h-8 text-sm w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availablePresets.map((p) => (
                  <SelectItem key={p.label} value={p.label}>
                    {p.label}
                  </SelectItem>
                ))}
                {currentPresetLabel === "自定义" && (
                  <SelectItem value="自定义">自定义</SelectItem>
                )}
              </SelectContent>
            </Select>
          )}

          {/* Width */}
          <input
            type="number"
            min={64}
            max={2048}
            step={64}
            className="flex h-8 w-20 rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            value={settings.txt2imgWidth}
            disabled={isDisabled}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10)
              if (!isNaN(v) && v >= 64 && v <= 2048) updateSettings({ txt2imgWidth: v })
            }}
          />
          <span className="text-muted-foreground text-sm">×</span>
          {/* Height */}
          <input
            type="number"
            min={64}
            max={2048}
            step={64}
            className="flex h-8 w-20 rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            value={settings.txt2imgHeight}
            disabled={isDisabled}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10)
              if (!isNaN(v) && v >= 64 && v <= 2048) updateSettings({ txt2imgHeight: v })
            }}
          />
          {/* Swap button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={handleSwapResolution}
            disabled={isDisabled}
            title="交换宽高"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
          </Button>
        </div>
        {showLowResWarning && (
          <p className="text-xs text-yellow-500">
            SDXL 建议分辨率至少 768×768，低分辨率可能影响生成质量
          </p>
        )}
      </div>

      {/* Settings row */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Steps: {settings.sdSteps}</Label>
          <Slider
            min={1}
            max={100}
            step={1}
            value={[settings.sdSteps]}
            onValueChange={([val]) => updateSettings({ sdSteps: val })}
            disabled={isDisabled}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Guidance Scale: {settings.sdGuidanceScale}</Label>
          <Slider
            min={1}
            max={20}
            step={0.5}
            value={[settings.sdGuidanceScale]}
            onValueChange={([val]) => updateSettings({ sdGuidanceScale: val })}
            disabled={isDisabled}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Sampler</Label>
          <Select
            value={settings.sdSampler}
            onValueChange={(val) => updateSettings({ sdSampler: val })}
            disabled={isDisabled}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {samplers.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Seed</Label>
          <input
            type="number"
            className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            value={settings.seedFixed ? settings.seed : -1}
            disabled={isDisabled}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              if (val === -1) {
                updateSettings({ seedFixed: false })
              } else {
                updateSettings({ seed: val, seedFixed: true })
              }
            }}
            placeholder="-1 (随机)"
          />
        </div>
      </div>

      {/* Generate button */}
      <Button
        className="w-full gap-2"
        onClick={handleGenerate}
        disabled={isDisabled || !settings.prompt.trim()}
      >
        {isGenerating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Wand2 className="h-4 w-4" />
        )}
        {isGenerating ? "生成中…" : "生成 (Ctrl+Enter)"}
      </Button>

      {/* Recommended models section */}
      <div className="flex flex-col gap-2">
        <button
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
          onClick={() => setShowRecommended((v) => !v)}
        >
          {showRecommended ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          推荐模型（RTX 4080 / 16GB）
        </button>

        {showRecommended && (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3 bg-muted/30">
            {RECOMMENDED_MODELS.map((rec) => {
              const isDownloaded = downloadedNames.has(rec.name)
              const isActive = settings.model.name === rec.name
              return (
                <div
                  key={rec.name}
                  className={cn(
                    "flex items-start justify-between gap-3 rounded-md p-2",
                    isActive && "bg-accent/20"
                  )}
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">{rec.label}</span>
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        ~{rec.vramGb}GB
                      </span>
                      {isActive && (
                        <span className="text-[10px] text-green-600 bg-green-100 dark:bg-green-900/30 px-1.5 py-0.5 rounded">
                          使用中
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{rec.description}</span>
                    {!isDownloaded && (
                      <span className="text-[10px] text-muted-foreground font-mono mt-0.5 select-all">
                        artie download --model {rec.name}
                      </span>
                    )}
                  </div>
                  {isDownloaded && !isActive && !serverConfig.disableModelSwitch && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs shrink-0"
                      disabled={isDisabled}
                      onClick={() => handleSwitchModel(rec.name)}
                    >
                      切换
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Generated images gallery */}
      {generatedImages.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm text-muted-foreground">
              已生成 ({generatedImages.length})
            </Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs gap-1 text-muted-foreground"
              onClick={clearGeneratedImages}
            >
              <Trash2 className="h-3 w-3" />
              清空
            </Button>
          </div>

          <div className="flex flex-col gap-4">
            {generatedImages.map((img, idx) => {
              const aspectRatio = settings.txt2imgWidth / settings.txt2imgHeight
              return (
                <div key={idx} className="flex flex-col gap-2 rounded-xl border border-border bg-card overflow-hidden">
                  {/* Image */}
                  <div
                    className="relative bg-muted w-full"
                    style={{ aspectRatio }}
                  >
                    <img
                      src={img.url}
                      alt={`Generated image ${idx + 1}`}
                      className="w-full h-full object-contain"
                    />
                    <div className="absolute bottom-1.5 right-1.5 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded">
                      seed: {img.seed}
                    </div>
                  </div>

                  {/* Action bar */}
                  <div className="flex flex-wrap gap-1.5 px-3 pb-3">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="gap-1.5 text-xs h-7"
                      onClick={() => handleEditImage(img.url)}
                      title="在 AI 擦除画布中打开"
                    >
                      <Edit2 className="h-3 w-3" />
                      AI 擦除
                    </Button>

                    {hasRealESRGAN && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="gap-1.5 text-xs h-7"
                        onClick={() => sendToTab(img.url, WorkspaceTab.SUPER_RES)}
                        title="AI 提升分辨率"
                      >
                        <Zap className="h-3 w-3" />
                        AI 超分
                      </Button>
                    )}

                    {hasRemoveBG && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="gap-1.5 text-xs h-7"
                        onClick={() => sendToTab(img.url, WorkspaceTab.REMOVE_BG)}
                        title="AI 去除背景"
                      >
                        <Scissors className="h-3 w-3" />
                        AI 去背景
                      </Button>
                    )}

                    {hasFaceRestore && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="gap-1.5 text-xs h-7"
                        onClick={() => sendToTab(img.url, WorkspaceTab.FACE_RESTORE)}
                        title="AI 修复人脸"
                      >
                        <Smile className="h-3 w-3" />
                        AI 修复人脸
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5 text-xs h-7 ml-auto text-muted-foreground"
                      onClick={() => handleDownloadImage(img.url, idx)}
                      title="下载图片"
                    >
                      <Download className="h-3 w-3" />
                      下载
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default GenerateTab
