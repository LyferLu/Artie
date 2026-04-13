import { useState } from "react"
import { useStore } from "@/lib/states"
import { Button, IconButton } from "../ui/button"
import { Label } from "../ui/label"
import {
  Loader2,
  Image as ImageIcon,
  Download,
  Undo,
  Redo,
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

const RemoveBGTab = () => {
  const [
    serverConfig,
    removeBgState,
    setFeatureSourceImage,
    setFeatureResultImage,
    setFeatureSelectedModel,
    undoFeatureResult,
    redoFeatureResult,
    undoFeatureResultDisabled,
    redoFeatureResultDisabled,
    clearCurrentWorkspace,
    currentWorkspaceSessionId,
  ] = useStore((state) => [
    state.serverConfig,
    state.removeBgState,
    state.setFeatureSourceImage,
    state.setFeatureResultImage,
    state.setFeatureSelectedModel,
    state.undoFeatureResult,
    state.redoFeatureResult,
    state.undoFeatureResultDisabled,
    state.redoFeatureResultDisabled,
    state.clearCurrentWorkspace,
    state.currentWorkspaceSessionId,
  ])
  const { toast } = useToast()
  const [isProcessing, setIsProcessing] = useState(false)

  const selectedModel =
    removeBgState.selectedModel || serverConfig.removeBGModel || "briaai/RMBG-1.4"
  const sourceImage = removeBgState.sourceImage
  const resultImage = removeBgState.resultImage
  const undoDisabled = undoFeatureResultDisabled(WorkspaceTab.REMOVE_BG)
  const redoDisabled = redoFeatureResultDisabled(WorkspaceTab.REMOVE_BG)

  const handleFileUpload = (file: File) => {
    clearCurrentWorkspace()
    setFeatureSourceImage(WorkspaceTab.REMOVE_BG, file)
    setFeatureSelectedModel(WorkspaceTab.REMOVE_BG, selectedModel)
  }

  const handleRemoveBG = async () => {
    if (!sourceImage) return
    setIsProcessing(true)
    try {
      await switchPluginModel(PluginName.RemoveBG, selectedModel)
      const res = await runPlugin(
        false,
        PluginName.RemoveBG,
        sourceImage.file,
        undefined,
        undefined,
        currentWorkspaceSessionId ?? undefined
      )
      const blob = await fetch(res.blob).then((r) => r.blob())
      const file = new File([blob], "removed_bg.png", { type: blob.type || "image/png" })
      setFeatureResultImage(WorkspaceTab.REMOVE_BG, file)
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
    a.download = "removed_bg.png"
    a.click()
  }

  return (
    <div className="relative flex flex-col h-full w-full max-w-3xl mx-auto px-6 py-6 gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>模型</Label>
          <Select
            value={selectedModel}
            onValueChange={(value) =>
              setFeatureSelectedModel(WorkspaceTab.REMOVE_BG, value)
            }
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {serverConfig.removeBGModels.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

      </div>

      {!sourceImage ? <ImageDropzone floating onSelection={handleFileUpload} /> : null}

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
            <Label className="text-sm text-muted-foreground">结果</Label>
            <div
              className="rounded-lg border border-border bg-muted/30 flex items-center justify-center min-h-[200px]"
              style={{
                backgroundImage:
                  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='8' height='8' fill='%23ccc'/%3E%3Crect x='8' y='8' width='8' height='8' fill='%23ccc'/%3E%3C/svg%3E\")",
                backgroundRepeat: "repeat",
              }}
            >
              {resultImage ? (
                <img src={resultImage.url} alt="Result" className="max-h-[400px] object-contain" />
              ) : (
                <span className="text-muted-foreground text-sm">结果将显示在此处</span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button className="flex-1 gap-2 min-w-[220px]" onClick={handleRemoveBG} disabled={!sourceImage || isProcessing}>
          {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
          {isProcessing ? "处理中…" : "AI 去背景"}
        </Button>
        <div className="ml-auto flex items-center gap-2 rounded-[3rem] border px-2 py-1.5 backdrop-filter backdrop-blur-md bg-background/70">
          <IconButton
            tooltip="Undo"
            onClick={() => undoFeatureResult(WorkspaceTab.REMOVE_BG)}
            disabled={undoDisabled}
          >
            <Undo />
          </IconButton>
          <IconButton
            tooltip="Redo"
            onClick={() => redoFeatureResult(WorkspaceTab.REMOVE_BG)}
            disabled={redoDisabled}
          >
            <Redo />
          </IconButton>
          <IconButton
            tooltip="Download"
            onClick={handleDownload}
            disabled={!resultImage}
          >
            <Download />
          </IconButton>
        </div>
      </div>
    </div>
  )
}

export default RemoveBGTab
