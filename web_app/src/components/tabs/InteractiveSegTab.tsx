import { useStore } from "@/lib/states"
import Editor from "../Editor"
import ImageSize from "../ImageSize"
import { InteractiveSeg } from "../InteractiveSeg"
import DiffusionProgress from "../DiffusionProgress"

const InteractiveSegTab = () => {
  const file = useStore((state) => state.file)

  return (
    <>
      <div className="flex gap-3 absolute top-[68px] left-[24px] items-center">
        <ImageSize />
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
