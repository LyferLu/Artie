import { useEffect } from "react"

import { useStore } from "@/lib/states"
import { AI_REPAINT_MODEL } from "@/lib/const"
import Editor from "../Editor"
import SidePanel from "../SidePanel"
import DiffusionProgress from "../DiffusionProgress"
import ImageSize from "../ImageSize"
import { Button } from "../ui/button"
import { Textarea } from "../ui/textarea"

const AIRepaintTab = () => {
  const [
    file,
    settings,
    serverConfig,
    isProcessing,
    updateSettings,
    runInpainting,
  ] = useStore((state) => [
    state.file,
    state.settings,
    state.serverConfig,
    state.getIsProcessing(),
    state.updateSettings,
    state.runInpainting,
  ])

  useEffect(() => {
    updateSettings({ showExtender: false })

    const repaintModel = serverConfig.modelInfos.find(
      (m) => m.name === AI_REPAINT_MODEL
    )
    if (repaintModel && repaintModel.name !== settings.model.name) {
      updateSettings({ model: repaintModel })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <div className="flex gap-3 absolute top-[68px] left-[24px] items-center">
        <ImageSize />
      </div>
      <div className="z-10 absolute top-[68px] left-1/2 -translate-x-1/2 w-[560px] max-w-[calc(100vw-180px)] rounded-xl border px-3 py-2 bg-background/90 backdrop-blur-sm">
        <div className="text-xs text-muted-foreground mb-1">
          AI重绘：先涂抹遮罩，再输入提示词，点击右侧“运行”替换遮罩区域内容
        </div>
        <div className="flex items-start gap-2">
          <Textarea
            value={settings.prompt}
            placeholder="例如：a wooden table with a vase of white flowers, realistic lighting"
            className="min-h-[64px] resize-none"
            onInput={(e) => {
              updateSettings({
                prompt: (e.target as HTMLTextAreaElement).value,
              })
            }}
          />
          <Button
            className="h-[64px] min-w-[88px]"
            disabled={isProcessing || !file || !settings.prompt.trim()}
            onClick={runInpainting}
          >
            运行
          </Button>
        </div>
      </div>
      <DiffusionProgress />
      <SidePanel />
      {file ? <Editor file={file} /> : (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          Please upload an image first
        </div>
      )}
    </>
  )
}

export default AIRepaintTab
