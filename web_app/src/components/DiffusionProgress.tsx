import * as React from "react"
import { io, Socket } from "socket.io-client"
import { Progress } from "./ui/progress"
import { useStore } from "@/lib/states"
import { Button } from "./ui/button"
import { Square } from "lucide-react"

export const API_ENDPOINT = import.meta.env.DEV
  ? import.meta.env.VITE_BACKEND
  : ""

const DiffusionProgress = () => {
  const [settings, isInpainting, isGenerating, isCancelingTask, cancelCurrentTask, isSD] = useStore((state) => [
    state.settings,
    state.isInpainting,
    state.isGenerating,
    state.isCancelingTask,
    state.cancelCurrentTask,
    state.isSD(),
  ])

  const [isConnected, setIsConnected] = React.useState(false)
  const [step, setStep] = React.useState(0)
  const socketRef = React.useRef<Socket | null>(null)
  const shouldTrackProgress = (isInpainting || isGenerating) && isSD

  const progress = Math.min(Math.round((step / settings.sdSteps) * 100), 100)

  React.useEffect(() => {
    if (!shouldTrackProgress) {
      socketRef.current?.disconnect()
      socketRef.current = null
      setIsConnected(false)
      setStep(0)
      return
    }

    const socket = io(API_ENDPOINT, {
      transports: ["websocket"],
    })
    socketRef.current = socket

    socket.on("connect", () => {
      setIsConnected(true)
    })

    socket.on("disconnect", () => {
      setIsConnected(false)
    })

    socket.on("diffusion_progress", (data) => {
      if (data) {
        setStep(data.step + 1)
      }
    })

    socket.on("diffusion_finish", () => {
      setStep(0)
    })

    return () => {
      socket.off("connect")
      socket.off("disconnect")
      socket.off("diffusion_progress")
      socket.off("diffusion_finish")
      socket.disconnect()
      if (socketRef.current === socket) {
        socketRef.current = null
      }
      setIsConnected(false)
    }
  }, [shouldTrackProgress])

  return (
    <div
      className="z-10 fixed bg-background w-[320px] left-1/2 -translate-x-1/2 top-[68px] h-[40px] flex justify-center items-center gap-3 border-[1px] border-[solid] rounded-[14px] pl-[8px] pr-[8px]"
      style={{
        visibility: isConnected && shouldTrackProgress ? "visible" : "hidden",
      }}
    >
      <Progress value={progress} />
      <div className="w-[45px] flex justify-center font-nums">{progress}%</div>
      <Button
        size="sm"
        variant="destructive"
        className="h-7 px-2 text-xs gap-1"
        disabled={isCancelingTask}
        onClick={() => {
          cancelCurrentTask()
        }}
      >
        <Square className="h-3 w-3" />
        {isCancelingTask ? "停止中..." : "停止"}
      </Button>
    </div>
  )
}

export default DiffusionProgress
