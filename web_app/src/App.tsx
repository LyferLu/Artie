import { useCallback, useEffect, useRef, useState } from "react"

import useInputImage from "@/hooks/useInputImage"
import { keepGUIAlive } from "@/lib/utils"
import { getServerConfig } from "@/lib/api"
import Header from "@/components/Header"
import MainLayout from "@/components/MainLayout"
import FileSelect from "@/components/FileSelect"
import AuthPage from "@/components/AuthPage"
import { Toaster } from "./components/ui/toaster"
import { useStore } from "./lib/states"
import { useWindowSize } from "react-use"
import { Loader2 } from "lucide-react"
import { WorkspaceTab } from "./lib/types"

const SUPPORTED_FILE_TYPE = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/bmp",
  "image/tiff",
]

function Home() {
  const [file, updateAppState, setFile, activeTab] = useStore((state) => [
    state.file,
    state.updateAppState,
    state.setFile,
    state.activeTab,
  ])

  const userInputImage = useInputImage()
  const windowSize = useWindowSize()

  useEffect(() => {
    if (userInputImage) {
      setFile(userInputImage)
    }
  }, [userInputImage, setFile])

  useEffect(() => {
    updateAppState({ windowSize })
  }, [windowSize])

  const dragCounter = useRef(0)

  const handleDrag = useCallback((event: any) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const handleDragIn = useCallback((event: any) => {
    event.preventDefault()
    event.stopPropagation()
    dragCounter.current += 1
  }, [])

  const handleDragOut = useCallback((event: any) => {
    event.preventDefault()
    event.stopPropagation()
    dragCounter.current -= 1
    if (dragCounter.current > 0) return
  }, [])

  const handleDrop = useCallback((event: any) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      if (event.dataTransfer.files.length === 1) {
        const dragFile = event.dataTransfer.files[0]
        if (SUPPORTED_FILE_TYPE.includes(dragFile.type)) {
          setFile(dragFile)
        }
      }
      event.dataTransfer.clearData()
    }
  }, [])

  const onPaste = useCallback((event: any) => {
    if (!event.clipboardData) return
    const items: DataTransferItem[] = [].slice
      .call(event.clipboardData.items)
      .filter((item: DataTransferItem) => item.type.indexOf("image") !== -1)

    if (items.length === 0) return
    event.preventDefault()
    event.stopPropagation()

    const blob = items[0].getAsFile()
    if (blob) setFile(blob)
  }, [])

  useEffect(() => {
    window.addEventListener("dragenter", handleDragIn)
    window.addEventListener("dragleave", handleDragOut)
    window.addEventListener("dragover", handleDrag)
    window.addEventListener("drop", handleDrop)
    window.addEventListener("paste", onPaste)
    return () => {
      window.removeEventListener("dragenter", handleDragIn)
      window.removeEventListener("dragleave", handleDragOut)
      window.removeEventListener("dragover", handleDrag)
      window.removeEventListener("drop", handleDrop)
      window.removeEventListener("paste", onPaste)
    }
  })

  const NEEDS_FILE_TABS = [
    WorkspaceTab.INPAINT,
    WorkspaceTab.OUTPAINT,
    WorkspaceTab.AI_REPAINT,
    WorkspaceTab.INTERACTIVE_SEG,
  ]
  const showFileSelect = !file && NEEDS_FILE_TABS.includes(activeTab)

  return (
    <main className="flex min-h-screen flex-col items-center justify-between w-full bg-[radial-gradient(circle_at_1px_1px,_#8e8e8e8e_1px,_transparent_0)] [background-size:20px_20px] bg-repeat">
      <Toaster />
      <Header />
      <MainLayout />
      {showFileSelect ? (
        <FileSelect
          onSelection={async (f) => {
            setFile(f)
          }}
        />
      ) : (
        <></>
      )}
    </main>
  )
}

export default function App() {
  const [isInitialized, setIsInitialized] = useState(false)
  const [serverConfig, setServerConfig, isAuthenticated, restoreSession] = useStore(
    (state) => [state.serverConfig, state.setServerConfig, state.isAuthenticated, state.restoreSession]
  )

  useEffect(() => {
    const init = async () => {
      try {
        const config = await getServerConfig()
        setServerConfig(config)
        if (config.isDesktop) keepGUIAlive()
      } catch {
        // server unreachable, continue anyway
      }
      await restoreSession()
      setIsInitialized(true)
    }
    init()
  }, [])

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Toaster />
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="text-sm">正在初始化…</span>
        </div>
      </div>
    )
  }

  if (serverConfig.enableAuth && !isAuthenticated) {
    return (
      <>
        <Toaster />
        <AuthPage />
      </>
    )
  }

  return <Home />
}
