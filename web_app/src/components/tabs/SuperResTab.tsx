import { useState } from "react"
import { useStore } from "@/lib/states"
import { Button } from "../ui/button"
import { Label } from "../ui/label"
import { ImageUploadButton } from "../ui/button"
import { Loader2, Image as ImageIcon, Download, Pencil, Scissors, Smile } from "lucide-react"
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

const SuperResTab = () => {
  const [serverConfig, workingImage, setWorkingImage, sendToTab] = useStore((state) => [
    state.serverConfig,
    state.workingImage,
    state.setWorkingImage,
    state.sendToTab,
  ])
  const { toast } = useToast()

  const [selectedModel, setSelectedModel] = useState(
    serverConfig.realesrganModel || "realesr-general-x4v3"
  )
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  const handleFileUpload = (file: File) => {
    setWorkingImage(file)
    setResultUrl(null)
  }

  const handleUpscale = async () => {
    if (!workingImage) return
    setIsProcessing(true)
    try {
      await switchPluginModel(PluginName.RealESRGAN, selectedModel)
      const res = await runPlugin(false, PluginName.RealESRGAN, workingImage.file, 4)
      setResultUrl(res.blob)
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
    if (!resultUrl) return
    const a = document.createElement("a")
    a.href = resultUrl
    a.download = "upscaled.png"
    a.click()
  }

  const hasRemoveBG = serverConfig.plugins.some((p) => p.name === PluginName.RemoveBG)
  const hasFaceRestore = serverConfig.plugins.some(
    (p) => p.name === PluginName.GFPGAN || p.name === PluginName.RestoreFormer
  )

  return (
    <div className="flex flex-col h-full w-full max-w-3xl mx-auto px-6 py-6 gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>模型</Label>
          <Select value={selectedModel} onValueChange={setSelectedModel}>
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

        <ImageUploadButton tooltip="上传图片" onFileUpload={handleFileUpload}>
          <ImageIcon className="h-4 w-4 mr-2" />
          上传图片
        </ImageUploadButton>
      </div>

      {workingImage && (
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">原图</Label>
            <img
              src={workingImage.url}
              alt="Source"
              className="rounded-lg border border-border object-contain max-h-[400px]"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">放大结果 (4x)</Label>
            <div className="rounded-lg border border-border bg-muted/30 flex items-center justify-center min-h-[200px]">
              {resultUrl ? (
                <img src={resultUrl} alt="Result" className="max-h-[400px] object-contain" />
              ) : (
                <span className="text-muted-foreground text-sm">结果将显示在此处</span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button
          className="flex-1 gap-2"
          onClick={handleUpscale}
          disabled={!workingImage || isProcessing}
        >
          {isProcessing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImageIcon className="h-4 w-4" />
          )}
          {isProcessing ? "处理中…" : "AI 提升分辨率 4x"}
        </Button>
        {resultUrl && (
          <Button variant="outline" onClick={handleDownload} className="gap-2">
            <Download className="h-4 w-4" />
            下载
          </Button>
        )}
      </div>

      {resultUrl && (
        <div className="flex flex-col gap-2">
          <Label className="text-sm text-muted-foreground">发送结果到</Label>
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant="secondary"
              className="gap-1.5 text-xs h-7"
              onClick={() => sendToTab(resultUrl, WorkspaceTab.INPAINT)}
            >
              <Pencil className="h-3 w-3" />
              AI 修复
            </Button>
            {hasRemoveBG && (
              <Button
                size="sm"
                variant="secondary"
                className="gap-1.5 text-xs h-7"
                onClick={() => sendToTab(resultUrl, WorkspaceTab.REMOVE_BG)}
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
                onClick={() => sendToTab(resultUrl, WorkspaceTab.FACE_RESTORE)}
              >
                <Smile className="h-3 w-3" />
                AI 修复人脸
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default SuperResTab
