import { useEffect, useState } from "react"
import { useStore } from "@/lib/states"
import { Button } from "../ui/button"
import { Label } from "../ui/label"
import { ImageUploadButton } from "../ui/button"
import { Loader2, Image as ImageIcon, Download } from "lucide-react"
import { useToast } from "../ui/use-toast"
import { PluginName, PluginInfo } from "@/lib/types"
import { runPlugin } from "@/lib/api"

const FaceRestoreTab = () => {
  const [plugins, consumePendingFile] = useStore((state) => [
    state.serverConfig.plugins,
    state.consumePendingFile,
  ])
  const { toast } = useToast()

  const hasGFPGAN = plugins.some((p: PluginInfo) => p.name === PluginName.GFPGAN)
  const hasRestoreFormer = plugins.some((p: PluginInfo) => p.name === PluginName.RestoreFormer)

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

  const handleRestore = async (pluginName: string) => {
    if (!sourceFile) return
    setIsProcessing(true)
    try {
      const res = await runPlugin(false, pluginName, sourceFile)
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

  if (!hasGFPGAN && !hasRestoreFormer) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        No face restoration plugin is enabled. Start server with --enable-gfpgan or --enable-restoreformer.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full w-full max-w-3xl mx-auto px-6 py-6 gap-6">
      <ImageUploadButton tooltip="Upload image" onFileUpload={handleFileUpload}>
        <ImageIcon className="h-4 w-4 mr-2" />
        Upload Image
      </ImageUploadButton>

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
            <Label className="text-sm text-muted-foreground">Restored</Label>
            <div className="rounded-lg border border-border bg-muted/30 flex items-center justify-center min-h-[200px]">
              {resultUrl ? (
                <img src={resultUrl} alt="Result" className="max-h-[400px] object-contain" />
              ) : (
                <span className="text-muted-foreground text-sm">Result will appear here</span>
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
            disabled={!sourceFile || isProcessing}
          >
            {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
            {isProcessing ? "Restoring..." : "GFPGAN"}
          </Button>
        )}
        {hasRestoreFormer && (
          <Button
            className="flex-1 gap-2"
            variant="outline"
            onClick={() => handleRestore(PluginName.RestoreFormer)}
            disabled={!sourceFile || isProcessing}
          >
            {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
            {isProcessing ? "Restoring..." : "RestoreFormer"}
          </Button>
        )}
        {resultUrl && (
          <Button variant="ghost" onClick={handleDownload} className="gap-2">
            <Download className="h-4 w-4" />
            Download
          </Button>
        )}
      </div>
    </div>
  )
}

export default FaceRestoreTab
