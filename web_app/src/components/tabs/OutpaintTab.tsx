import { useEffect } from "react"
import { useStore } from "@/lib/states"
import Editor from "../Editor"
import SidePanel from "../SidePanel"
import DiffusionProgress from "../DiffusionProgress"
import { ExtenderDirection } from "@/lib/types"
import ImageSize from "../ImageSize"

const OutpaintTab = () => {
  const [file, settings, serverConfig, updateSettings, updateExtenderDirection] =
    useStore((state) => [
      state.file,
      state.settings,
      state.serverConfig,
      state.updateSettings,
      state.updateExtenderDirection,
    ])

  // Automatically enable extender when switching to this tab
  useEffect(() => {
    updateSettings({ showExtender: true })
    updateExtenderDirection(ExtenderDirection.xy)
    // 刷新后直接进入该 tab 时，只更新前端模型元数据，不触发后端切模
    if (!settings.model.support_outpainting) {
      const fallback =
        serverConfig.modelInfos.find(
          (m) => m.name === "diffusers/stable-diffusion-xl-1.0-inpainting-0.1"
        ) ?? serverConfig.modelInfos.find((m) => m.support_outpainting)
      if (fallback) {
        updateSettings({ model: fallback })
      }
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
