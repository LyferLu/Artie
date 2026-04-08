import { useEffect, useState } from "react"
import { useStore } from "@/lib/states"
import { Button } from "../ui/button"
import { Label } from "../ui/label"
import { ImageUploadButton } from "../ui/button"
import { Loader2, Image as ImageIcon, Download } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select"
import { useToast } from "../ui/use-toast"
import { PluginName } from "@/lib/types"
import { runPlugin } from "@/lib/api"

const RemoveBGTab = () => {
  const [serverConfig, consumePendingFile] = useStore((state) => [
    state.serverConfig,
    state.consumePendingFile,
  ])
  const { toast } = useToast()

  const [selectedModel, setSelectedModel] = useState(
    serverConfig.removeBGModel || "briaai/RMBG-1.4"
  )
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  useEffect(() => {
    const pending = consumePendingFile()
    if (pending) {
      setSourceFile(pending.file)
      setSourceUrl(pending.url)
      setResultUrl(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleFileUpload = (file: File) => {
    setSourceFile(file)
    setSourceUrl(URL.createObjectURL(file))
    setResultUrl(null)
  }

  const handleRemoveBG = async () => {
    if (!sourceFile) return
    setIsProcessing(true)
    try {
      const res = await runPlugin(false, PluginName.RemoveBG, sourceFile)
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
    a.download = "removed_bg.png"
    a.click()
  }

  return (
    <div className="flex flex-col h-full w-full max-w-3xl mx-auto px-6 py-6 gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Model</Label>
          <Select value={selectedModel} onValueChange={setSelectedModel}>
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

        <ImageUploadButton
          tooltip="上传图片"
          onFileUpload={handleFileUpload}
        >
          <ImageIcon className="h-4 w-4 mr-2" />
          上传图片
        </ImageUploadButton>
      </div>

      {sourceUrl && (
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">Original</Label>
            <img
              src={sourceUrl}
              alt="Source"
              className="rounded-lg border border-border object-contain max-h-[400px]"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-muted-foreground">Result</Label>
            <div className="rounded-lg border border-border bg-muted/30 flex items-center justify-center min-h-[200px]"
              style={{
                backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='8' height='8' fill='%23ccc'/%3E%3Crect x='8' y='8' width='8' height='8' fill='%23ccc'/%3E%3C/svg%3E\")",
                backgroundRepeat: "repeat",
              }}
            >
              {resultUrl ? (
                <img
                  src={resultUrl}
                  alt="Result"
                  className="max-h-[400px] object-contain"
                />
              ) : (
                <span className="text-muted-foreground text-sm">Result will appear here</span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button
          className="flex-1 gap-2"
          onClick={handleRemoveBG}
          disabled={!sourceFile || isProcessing}
        >
          {isProcessing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImageIcon className="h-4 w-4" />
          )}
          {isProcessing ? "处理中…" : "AI 去背景"}
        </Button>
        {resultUrl && (
          <Button variant="outline" onClick={handleDownload} className="gap-2">
            <Download className="h-4 w-4" />
            Download
          </Button>
        )}
      </div>
    </div>
  )
}

export default RemoveBGTab
