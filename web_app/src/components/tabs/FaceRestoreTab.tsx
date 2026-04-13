import { useState } from "react"
import { useStore } from "@/lib/states"
import { Button } from "../ui/button"
import { Label } from "../ui/label"
import {
  Loader2,
  Image as ImageIcon,
  Download,
} from "lucide-react"
import { useToast } from "../ui/use-toast"
import { PluginName, PluginInfo, WorkspaceTab } from "@/lib/types"
import { runPlugin } from "@/lib/api"
import ImageDropzone from "../ImageDropzone"

const FaceRestoreTab = () => {
  const [
    plugins,
    faceRestoreState,
    setFeatureSourceImage,
    setFeatureResultImage,
    setFeatureSelectedModel,
    clearCurrentWorkspace,
    currentWorkspaceSessionId,
  ] = useStore((state) => [
    state.serverConfig.plugins,
    state.faceRestoreState,
    state.setFeatureSourceImage,
    state.setFeatureResultImage,
    state.setFeatureSelectedModel,
    state.clearCurrentWorkspace,
    state.currentWorkspaceSessionId,
  ])
  const { toast } = useToast()
  const [isProcessing, setIsProcessing] = useState(false)

  const hasGFPGAN = plugins.some((p: PluginInfo) => p.name === PluginName.GFPGAN)
  const hasRestoreFormer = plugins.some((p: PluginInfo) => p.name === PluginName.RestoreFormer)
  const sourceImage = faceRestoreState.sourceImage
  const resultImage = faceRestoreState.resultImage

  const handleFileUpload = (file: File) => {
    clearCurrentWorkspace()
    setFeatureSourceImage(WorkspaceTab.FACE_RESTORE, file)
  }

  const handleRestore = async (pluginName: string) => {
    if (!sourceImage) return
    setIsProcessing(true)
    try {
      const res = await runPlugin(
        false,
        pluginName,
        sourceImage.file,
        undefined,
        undefined,
        currentWorkspaceSessionId ?? undefined
      )
      const blob = await fetch(res.blob).then((r) => r.blob())
      const file = new File([blob], "face_restored.png", { type: blob.type || "image/png" })
      setFeatureSelectedModel(WorkspaceTab.FACE_RESTORE, pluginName)
      setFeatureResultImage(WorkspaceTab.FACE_RESTORE, file)
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
    a.download = "face_restored.png"
    a.click()
  }

  if (!hasGFPGAN && !hasRestoreFormer) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        没有启用人脸修复插件。请使用 --enable-gfpgan 或 --enable-restoreformer 启动服务器。
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full w-full max-w-3xl mx-auto px-6 py-6 gap-6">
      {!sourceImage ? <ImageDropzone onSelection={handleFileUpload} /> : null}

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
            <Label className="text-sm text-muted-foreground">修复结果</Label>
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

      <div className="flex gap-2 flex-wrap">
        {hasGFPGAN && (
          <Button className="flex-1 gap-2" onClick={() => handleRestore(PluginName.GFPGAN)} disabled={!sourceImage || isProcessing}>
            {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
            {isProcessing ? "处理中…" : "GFPGAN"}
          </Button>
        )}
        {hasRestoreFormer && (
          <Button
            className="flex-1 gap-2"
            variant="outline"
            onClick={() => handleRestore(PluginName.RestoreFormer)}
            disabled={!sourceImage || isProcessing}
          >
            {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
            {isProcessing ? "处理中…" : "RestoreFormer"}
          </Button>
        )}
        {resultImage && (
          <Button variant="ghost" onClick={handleDownload} className="gap-2">
            <Download className="h-4 w-4" />
            下载
          </Button>
        )}
      </div>
    </div>
  )
}

export default FaceRestoreTab
