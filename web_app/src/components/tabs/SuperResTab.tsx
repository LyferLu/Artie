import { useState } from "react"
import { useStore } from "@/lib/states"
import { Button } from "../ui/button"
import { Label } from "../ui/label"
import {
  Loader2,
  Image as ImageIcon,
  Download,
} from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select"
import { useToast } from "../ui/use-toast"
import { PluginName, WorkspaceTab } from "@/lib/types"
import { runPlugin, switchPluginModel } from "@/lib/api"
import ImageDropzone from "../ImageDropzone"

const SuperResTab = () => {
  const [
    serverConfig,
    superResState,
    setFeatureSourceImage,
    setFeatureResultImage,
    setFeatureSelectedModel,
    clearCurrentWorkspace,
    currentWorkspaceSessionId,
  ] = useStore((state) => [
    state.serverConfig,
    state.superResState,
    state.setFeatureSourceImage,
    state.setFeatureResultImage,
    state.setFeatureSelectedModel,
    state.clearCurrentWorkspace,
    state.currentWorkspaceSessionId,
  ])
  const { toast } = useToast()
  const [isProcessing, setIsProcessing] = useState(false)

  const selectedModel =
    superResState.selectedModel || serverConfig.realesrganModel || "realesr-general-x4v3"
  const sourceImage = superResState.sourceImage
  const resultImage = superResState.resultImage

  const handleFileUpload = (file: File) => {
    clearCurrentWorkspace()
    setFeatureSourceImage(WorkspaceTab.SUPER_RES, file)
    setFeatureSelectedModel(WorkspaceTab.SUPER_RES, selectedModel)
  }

  const handleUpscale = async () => {
    if (!sourceImage) return
    setIsProcessing(true)
    try {
      await switchPluginModel(PluginName.RealESRGAN, selectedModel)
      const res = await runPlugin(
        false,
        PluginName.RealESRGAN,
        sourceImage.file,
        4,
        undefined,
        currentWorkspaceSessionId ?? undefined
      )
      const blob = await fetch(res.blob).then((r) => r.blob())
      const file = new File([blob], "upscaled.png", { type: blob.type || "image/png" })
      setFeatureResultImage(WorkspaceTab.SUPER_RES, file)
    } catch (e: any) {
      toast({
        variant: "destructive",
        description: e.message ? e.message : e.toString(),
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDownload = () => {
    if (!resultImage) return
    const a = document.createElement("a")
    a.href = resultImage.url
    a.download = "upscaled.png"
    a.click()
  }

  return (
    <div className="flex flex-col h-full w-full max-w-3xl mx-auto px-6 py-6 gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>模型</Label>
          <Select
            value={selectedModel}
            onValueChange={(value) => setFeatureSelectedModel(WorkspaceTab.SUPER_RES, value)}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {serverConfig.realesrganModels.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!sourceImage ? (
          <ImageDropzone onSelection={handleFileUpload} />
        ) : null}
      </div>

      {sourceImage && (
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">原图</Label>
            <img
              src={sourceImage.url}
              alt="Source"
              className="rounded-lg border border-border object-contain max-h-[400px]"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">放大结果 (4x)</Label>
            <div className="rounded-lg border border-border bg-muted/30 flex items-center justify-center min-h-[200px]">
              {resultImage ? (
                <img src={resultImage.url} alt="Result" className="max-h-[400px] object-contain" />
              ) : (
                <span className="text-muted-foreground text-sm">结果将显示在此处</span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button className="flex-1 gap-2" onClick={handleUpscale} disabled={!sourceImage || isProcessing}>
          {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
          {isProcessing ? "处理中…" : "AI 提升分辨率 4x"}
        </Button>
        {resultImage && (
          <Button variant="outline" onClick={handleDownload} className="gap-2">
            <Download className="h-4 w-4" />
            下载
          </Button>
        )}
      </div>
    </div>
  )
}

export default SuperResTab
