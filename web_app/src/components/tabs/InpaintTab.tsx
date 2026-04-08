import { useStore } from "@/lib/states"
import Editor from "../Editor"
import ImageSize from "../ImageSize"
import Plugins from "../Plugins"
import { InteractiveSeg } from "../InteractiveSeg"
import SidePanel from "../SidePanel"
import DiffusionProgress from "../DiffusionProgress"

const InpaintTab = () => {
  const file = useStore((state) => state.file)

  return (
    <>
      <div className="flex gap-3 absolute top-[68px] left-[24px] items-center">
        <Plugins />
        <ImageSize />
      </div>
      <InteractiveSeg />
      <DiffusionProgress />
      <SidePanel />
      {file ? <Editor file={file} /> : <></>}
    </>
  )
}

export default InpaintTab
