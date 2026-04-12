import { useEffect } from "react"
import { useStore } from "@/lib/states"
import Editor from "../Editor"
import ImageSize from "../ImageSize"
import { InteractiveSeg } from "../InteractiveSeg"
import DiffusionProgress from "../DiffusionProgress"

const InteractiveSegTab = () => {
  const [file, updateInteractiveSegState, resetInteractiveSegState] = useStore(
    (state) => [
      state.file,
      state.updateInteractiveSegState,
      state.resetInteractiveSegState,
    ]
  )

  useEffect(() => {
    updateInteractiveSegState({ isInteractiveSeg: true })
    return () => {
      resetInteractiveSegState()
    }
  }, [file, updateInteractiveSegState, resetInteractiveSegState])

  return (
    <>
      <div className="flex gap-3 absolute top-[68px] left-[24px] items-center">
        <ImageSize />
      </div>
      <div className="z-10 absolute top-[112px] rounded-xl border-solid border px-3 py-1.5 left-1/2 translate-x-[-50%] text-xs text-muted-foreground bg-background/90 pointer-events-none">
        左键添加前景点，右键添加背景点；每次点击会实时更新，完成后点上方 Accept 应用遮罩
      </div>
      <InteractiveSeg />
      <DiffusionProgress />
      {file ? <Editor file={file} /> : (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          Please upload an image first
        </div>
      )}
    </>
  )
}

export default InteractiveSegTab
