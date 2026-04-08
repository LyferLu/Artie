import { useEffect } from "react"
import { useStore } from "@/lib/states"
import Editor from "../Editor"
import SidePanel from "../SidePanel"
import DiffusionProgress from "../DiffusionProgress"
import { ExtenderDirection } from "@/lib/types"
import ImageSize from "../ImageSize"
import { switchTab } from "@/lib/api"

const OutpaintTab = () => {
  const [file, settings, updateSettings, updateExtenderDirection] = useStore((state) => [
    state.file,
    state.settings,
    state.updateSettings,
    state.updateExtenderDirection,
  ])

  // Automatically enable extender when switching to this tab
  useEffect(() => {
    updateSettings({ showExtender: true })
    updateExtenderDirection(ExtenderDirection.xy)
    // 确保后端模型支持外扩（应对刷新后直接进入此 tab 的场景）
    if (!settings.model.support_outpainting) {
      switchTab("outpaint")
        .then((newModel) => updateSettings({ model: newModel }))
        .catch(console.error)
    }
    return () => {
      updateSettings({ showExtender: false })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <div className="flex gap-3 absolute top-[68px] left-[24px] items-center">
        <ImageSize />
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

export default OutpaintTab
