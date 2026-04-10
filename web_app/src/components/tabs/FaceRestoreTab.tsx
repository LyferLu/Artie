import { useState } from "react"
import { useStore } from "@/lib/states"
import { Button } from "../ui/button"
import { Label } from "../ui/label"
import { ImageUploadButton } from "../ui/button"
import { Loader2, Image as ImageIcon, Download, Pencil, Scissors, Zap } from "lucide-react"
import { useToast } from "../ui/use-toast"
import { PluginName, PluginInfo, WorkspaceTab } from "@/lib/types"
import { runPlugin } from "@/lib/api"

const FaceRestoreTab = () => {
  const [plugins, workingImage, setWorkingImage, sendToTab, serverConfig] = useStore((state) => [
    state.serverConfig.plugins,
    state.workingImage,
    state.setWorkingImage,
    state.sendToTab,
    state.serverConfig,
  ])
  const { toast } = useToast()

  const hasGFPGAN = plugins.some((p: PluginInfo) => p.name === PluginName.GFPGAN)
  const hasRestoreFormer = plugins.some((p: PluginInfo) => p.name === PluginName.RestoreFormer)

  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  const handleFileUpload = (file: File) => {
    setWorkingImage(file)
    setResultUrl(null)
  }

  const handleRestore = async (pluginName: string) => {
    if (!workingImage) return
    setIsProcessing(true)
    try {
      const res = await runPlugin(false, pluginName, workingImage.file)
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
    a.download = "face_restored.png"
    a.click()
  }

  const hasRemoveBG = serverConfig.plugins.some((p) => p.name === PluginName.RemoveBG)
  const hasRealESRGAN = serverConfig.plugins.some((p) => p.name === PluginName.RealESRGAN)

  if (!hasGFPGAN && !hasRestoreFormer) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        没有启用人脸修复插件。请使用 --enable-gfpgan 或 --enable-restoreformer 启动服务器。
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full w-full max-w-3xl mx-auto px-6 py-6 gap-6">
      <ImageUploadButton tooltip="上传图片" onFileUpload={handleFileUpload}>
        <ImageIcon className="h-4 w-4 mr-2" />
        上传图片
      </ImageUploadButton>

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
            <Label className="text-sm text-muted-foreground">修复结果</Label>
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

      <div className="flex gap-2 flex-wrap">
        {hasGFPGAN && (
          <Button
            className="flex-1 gap-2"
            onClick={() => handleRestore(PluginName.GFPGAN)}
            disabled={!workingImage || isProcessing}
          >
            {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
            {isProcessing ? "处理中…" : "GFPGAN"}
          </Button>
        )}
        {hasRestoreFormer && (
          <Button
            className="flex-1 gap-2"
            variant="outline"
            onClick={() => handleRestore(PluginName.RestoreFormer)}
            disabled={!workingImage || isProcessing}
          >
            {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
            {isProcessing ? "处理中…" : "RestoreFormer"}
          </Button>
        )}
        {resultUrl && (
          <Button variant="ghost" onClick={handleDownload} className="gap-2">
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
            {hasRealESRGAN && (
              <Button
                size="sm"
                variant="secondary"
                className="gap-1.5 text-xs h-7"
                onClick={() => sendToTab(resultUrl, WorkspaceTab.SUPER_RES)}
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
                onClick={() => sendToTab(resultUrl, WorkspaceTab.REMOVE_BG)}
              >
                <Scissors className="h-3 w-3" />
                AI 去背景
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default FaceRestoreTab
