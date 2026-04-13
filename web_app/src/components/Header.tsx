import { PlayIcon } from "@radix-ui/react-icons"
import { useState } from "react"
import { IconButton, ImageUploadButton } from "@/components/ui/button"
import Shortcuts from "@/components/Shortcuts"
import { useImage } from "@/hooks/useImage"

import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover"
import { RotateCw, Image, Upload, LogOut, User, Save } from "lucide-react"
import FileManager, { MASK_TAB } from "./FileManager"
import { getMediaBlob, getMediaFile } from "@/lib/api"
import { useStore } from "@/lib/states"
import SettingsDialog from "./Settings"
import { cn, fileToImage } from "@/lib/utils"
import Coffee from "./Coffee"
import { useToast } from "./ui/use-toast"
import { WorkspaceTab } from "@/lib/types"
import { AI_REPAINT_MODEL } from "@/lib/const"

const Header = () => {
  const [
    file,
    customMask,
    isInpainting,
    isProcessing,
    serverConfig,
    runMannually,
    enableUploadMask,
    model,
    user,
    isAuthenticated,
    activeTab,
    isSavingWorkspace,
    hasSavableWorkspaceContent,
    loadImageForTab,
    setCustomFile,
    runInpainting,
    showPrevMask,
    hidePrevMask,
    imageHeight,
    imageWidth,
    handleFileManagerMaskSelect,
    logout,
    saveWorkspace,
    clearCurrentWorkspace,
  ] = useStore((state) => [
    state.file,
    state.customMask,
    state.isInpainting,
    state.getIsProcessing(),
    state.serverConfig,
    state.runMannually(),
    state.settings.enableUploadMask,
    state.settings.model,
    state.user,
    state.isAuthenticated,
    state.activeTab,
    state.isSavingWorkspace,
    state.hasSavableWorkspaceContent,
    state.loadImageForTab,
    state.setCustomFile,
    state.runInpainting,
    state.showPrevMask,
    state.hidePrevMask,
    state.imageHeight,
    state.imageWidth,
    state.handleFileManagerMaskSelect,
    state.logout,
    state.saveWorkspace,
    state.clearCurrentWorkspace,
  ])

  const { toast } = useToast()
  const [maskImage, maskImageLoaded] = useImage(customMask)
  const [openMaskPopover, setOpenMaskPopover] = useState(false)

  const handleRerunLastMask = () => {
    runInpainting()
  }

  const onRerunMouseEnter = () => {
    showPrevMask()
  }

  const onRerunMouseLeave = () => {
    hidePrevMask()
  }

  const canRunOutpaint = serverConfig.modelInfos.some(
    (m) => m.support_outpainting
  )
  const canRunAIRepaint = serverConfig.modelInfos.some(
    (m) => m.name === AI_REPAINT_MODEL
  )
  const canSaveWorkspace =
    isAuthenticated &&
    activeTab !== WorkspaceTab.MY_WORKSPACE &&
    hasSavableWorkspaceContent()

  const handleOnPhotoClick = async (tab: string, filename: string) => {
    try {
      if (tab === MASK_TAB) {
        const maskBlob = await getMediaBlob(tab, filename)
        handleFileManagerMaskSelect(maskBlob)
      } else {
        const newFile = await getMediaFile(tab, filename)
        clearCurrentWorkspace()
        loadImageForTab(newFile, activeTab)
      }
    } catch (e: any) {
      toast({
        variant: "destructive",
        description: e.message ? e.message : e.toString(),
      })
      return
    }
  }

  return (
    <header className="h-[60px] px-6 py-4 absolute top-[0] flex justify-between items-center w-full z-20 border-b backdrop-filter backdrop-blur-md bg-background/70">
      <div className="flex items-center gap-1">
        {serverConfig.enableFileManager ? (
          <FileManager photoWidth={512} onPhotoClick={handleOnPhotoClick} />
        ) : (
          <></>
        )}

          <ImageUploadButton
          disabled={isInpainting}
          tooltip="上传图片"
          onFileUpload={(file) => {
            clearCurrentWorkspace()
            loadImageForTab(file, activeTab)
          }}
        >
          <Image />
        </ImageUploadButton>

        {canSaveWorkspace ? (
          <IconButton
            disabled={isProcessing || isSavingWorkspace}
            tooltip={isSavingWorkspace ? "保存中…" : "保存到我的作品"}
            onClick={saveWorkspace}
          >
            <Save />
          </IconButton>
        ) : null}

        <div
          className={cn([
            "flex items-center gap-1",
            file && enableUploadMask ? "visible" : "hidden",
          ])}
        >
          <ImageUploadButton
            disabled={isInpainting}
            tooltip="上传自定义遮罩"
            onFileUpload={async (file) => {
              let newCustomMask: HTMLImageElement | null = null
              try {
                newCustomMask = await fileToImage(file)
              } catch (e: any) {
                toast({
                  variant: "destructive",
                  description: e.message ? e.message : e.toString(),
                })
                return
              }
              if (
                newCustomMask.naturalHeight !== imageHeight ||
                newCustomMask.naturalWidth !== imageWidth
              ) {
                toast({
                  variant: "destructive",
                  description: `The size of the mask must same as image: ${imageWidth}x${imageHeight}`,
                })
                return
              }

              setCustomFile(file)
              if (!runMannually) {
                runInpainting()
              }
            }}
          >
            <Upload />
          </ImageUploadButton>

          {customMask ? (
            <Popover open={openMaskPopover}>
              <PopoverTrigger
                className="btn-primary side-panel-trigger"
                onMouseEnter={() => setOpenMaskPopover(true)}
                onMouseLeave={() => setOpenMaskPopover(false)}
                style={{
                  visibility: customMask ? "visible" : "hidden",
                  outline: "none",
                }}
                onClick={() => {
                  if (customMask) {
                  }
                }}
              >
                <IconButton tooltip="运行自定义遮罩">
                  <PlayIcon />
                </IconButton>
              </PopoverTrigger>
              <PopoverContent>
                {maskImageLoaded ? (
                  <img src={maskImage.src} alt="Custom mask" />
                ) : (
                  <></>
                )}
              </PopoverContent>
            </Popover>
          ) : (
            <></>
          )}
        </div>

        {file && !model.need_prompt && (activeTab === WorkspaceTab.INPAINT || activeTab === WorkspaceTab.OUTPAINT) ? (
          <IconButton
            disabled={isInpainting}
            tooltip="重新运行上次遮罩"
            onClick={handleRerunLastMask}
            onMouseEnter={onRerunMouseEnter}
            onMouseLeave={onRerunMouseLeave}
          >
            <RotateCw />
          </IconButton>
        ) : (
          <></>
        )}

        {file && activeTab === WorkspaceTab.OUTPAINT && canRunOutpaint ? (
          <IconButton
            disabled={isProcessing}
            tooltip="运行外扩"
            onClick={runInpainting}
          >
            <PlayIcon />
          </IconButton>
        ) : (
          <></>
        )}

        {file && activeTab === WorkspaceTab.AI_REPAINT && canRunAIRepaint ? (
          <IconButton
            disabled={isProcessing}
            tooltip="运行AI重绘"
            onClick={runInpainting}
          >
            <PlayIcon />
          </IconButton>
        ) : (
          <></>
        )}
      </div>

      {/* Right side: user info + settings */}
      <div className="flex gap-1 items-center">
        <Coffee />
        <Shortcuts />
        {serverConfig.disableModelSwitch ? <></> : <SettingsDialog />}
        {isAuthenticated && user && (
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1.5 px-2 py-1 rounded-md text-sm hover:bg-accent transition-colors">
                <User className="h-4 w-4" />
                <span className="max-w-[80px] truncate">{user.username}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-40 p-1" align="end">
              <button
                className="flex w-full items-center gap-2 px-2 py-1.5 rounded-sm text-sm hover:bg-accent transition-colors"
                onClick={logout}
              >
                <LogOut className="h-4 w-4" />
                退出登录
              </button>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </header>
  )
}

export default Header
