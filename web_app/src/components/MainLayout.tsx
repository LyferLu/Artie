import { useStore } from "@/lib/states"
import { WorkspaceTab, PluginName } from "@/lib/types"
import {
  Wand2,
  Pencil,
  Edit2,
  Expand,
  Scissors,
  Zap,
  Smile,
  MousePointer2,
  FolderOpen,
} from "lucide-react"
import { cn } from "@/lib/utils"
import DiffusionProgress from "./DiffusionProgress"
import GenerateTab from "./tabs/GenerateTab"
import InpaintTab from "./tabs/InpaintTab"
import OutpaintTab from "./tabs/OutpaintTab"
import AIRepaintTab from "./tabs/AIRepaintTab"
import RemoveBGTab from "./tabs/RemoveBGTab"
import SuperResTab from "./tabs/SuperResTab"
import FaceRestoreTab from "./tabs/FaceRestoreTab"
import InteractiveSegTab from "./tabs/InteractiveSegTab"
import MyWorkspaceTab from "./tabs/MyWorkspaceTab"

interface TabDef {
  id: WorkspaceTab
  label: string
  icon: React.ReactNode
  visible: (ctx: TabVisibilityCtx) => boolean
}

interface TabVisibilityCtx {
  supportTxt2img: boolean
  hasAnyTxt2imgModel: boolean
  hasAnyOutpaintingModel: boolean
  hasRemoveBG: boolean
  hasRealESRGAN: boolean
  hasGFPGAN: boolean
  hasRestoreFormer: boolean
  hasInteractiveSeg: boolean
}

const TAB_DEFS: TabDef[] = [
  {
    id: WorkspaceTab.GENERATE,
    label: "文生图",
    icon: <Wand2 className="h-5 w-5" />,
    visible: (ctx) => ctx.supportTxt2img || ctx.hasAnyTxt2imgModel,
  },
  {
    id: WorkspaceTab.INPAINT,
    label: "AI擦除",
    icon: <Pencil className="h-5 w-5" />,
    visible: () => true,
  },
  {
    id: WorkspaceTab.OUTPAINT,
    label: "AI扩图",
    icon: <Expand className="h-5 w-5" />,
    visible: (ctx) => ctx.hasAnyOutpaintingModel,
  },
  {
    id: WorkspaceTab.AI_REPAINT,
    label: "AI重绘",
    icon: <Edit2 className="h-5 w-5" />,
    visible: (ctx) => ctx.supportTxt2img || ctx.hasAnyTxt2imgModel,
  },
  {
    id: WorkspaceTab.REMOVE_BG,
    label: "去背景",
    icon: <Scissors className="h-5 w-5" />,
    visible: (ctx) => ctx.hasRemoveBG,
  },
  {
    id: WorkspaceTab.SUPER_RES,
    label: "超分辨率",
    icon: <Zap className="h-5 w-5" />,
    visible: (ctx) => ctx.hasRealESRGAN,
  },
  {
    id: WorkspaceTab.FACE_RESTORE,
    label: "修复人脸",
    icon: <Smile className="h-5 w-5" />,
    visible: (ctx) => ctx.hasGFPGAN || ctx.hasRestoreFormer,
  },
  {
    id: WorkspaceTab.INTERACTIVE_SEG,
    label: "智能选区",
    icon: <MousePointer2 className="h-5 w-5" />,
    visible: (ctx) => ctx.hasInteractiveSeg,
  },
  {
    id: WorkspaceTab.MY_WORKSPACE,
    label: "我的作品",
    icon: <FolderOpen className="h-5 w-5" />,
    visible: () => true,
  },
]

function hasPlugin(plugins: { name: string }[], name: string): boolean {
  return plugins.some((p) => p.name === name)
}

const MainLayout = () => {
  const [activeTab, setActiveTab, serverConfig, model] = useStore(
    (state) => [
      state.activeTab,
      state.setActiveTab,
      state.serverConfig,
      state.settings.model,
    ]
  )

  const hasAnyTxt2imgModel = serverConfig.modelInfos.some((m) => m.support_txt2img)
  const hasAnyOutpaintingModel = serverConfig.modelInfos.some((m) => m.support_outpainting)

  const visCtx: TabVisibilityCtx = {
    supportTxt2img: model.support_txt2img,
    hasAnyTxt2imgModel,
    hasAnyOutpaintingModel,
    hasRemoveBG: hasPlugin(serverConfig.plugins, PluginName.RemoveBG),
    hasRealESRGAN: hasPlugin(serverConfig.plugins, PluginName.RealESRGAN),
    hasGFPGAN: hasPlugin(serverConfig.plugins, PluginName.GFPGAN),
    hasRestoreFormer: hasPlugin(serverConfig.plugins, PluginName.RestoreFormer),
    hasInteractiveSeg: hasPlugin(serverConfig.plugins, PluginName.InteractiveSeg),
  }

  const visibleTabs = TAB_DEFS.filter((t) => t.visible(visCtx))

  // If current activeTab is no longer visible, fall back to the first visible tab.
  const effectiveTab = visibleTabs.find((t) => t.id === activeTab)
    ? activeTab
    : (visibleTabs[0]?.id ?? WorkspaceTab.GENERATE)

  const renderContent = () => {
    switch (effectiveTab) {
      case WorkspaceTab.GENERATE:
        return (
          <div className="absolute top-[60px] left-[64px] right-0 bottom-0 overflow-y-auto">
            <DiffusionProgress />
            <GenerateTab />
          </div>
        )
      case WorkspaceTab.INPAINT:
        return (
          <div className="absolute top-0 left-[64px] right-0 bottom-0">
            <InpaintTab />
          </div>
        )
      case WorkspaceTab.OUTPAINT:
        return (
          <div className="absolute top-0 left-[64px] right-0 bottom-0">
            <OutpaintTab />
          </div>
        )
      case WorkspaceTab.AI_REPAINT:
        return (
          <div className="absolute top-0 left-[64px] right-0 bottom-0">
            <AIRepaintTab />
          </div>
        )
      case WorkspaceTab.REMOVE_BG:
        return (
          <div className="absolute top-[60px] left-[64px] right-0 bottom-0 overflow-y-auto">
            <RemoveBGTab />
          </div>
        )
      case WorkspaceTab.SUPER_RES:
        return (
          <div className="absolute top-[60px] left-[64px] right-0 bottom-0 overflow-y-auto">
            <SuperResTab />
          </div>
        )
      case WorkspaceTab.FACE_RESTORE:
        return (
          <div className="absolute top-[60px] left-[64px] right-0 bottom-0 overflow-y-auto">
            <FaceRestoreTab />
          </div>
        )
      case WorkspaceTab.INTERACTIVE_SEG:
        return (
          <div className="absolute top-0 left-[64px] right-0 bottom-0">
            <InteractiveSegTab />
          </div>
        )
      case WorkspaceTab.MY_WORKSPACE:
        return (
          <div className="absolute top-[60px] left-[64px] right-0 bottom-0 overflow-hidden">
            <MyWorkspaceTab />
          </div>
        )
      default:
        return null
    }
  }

  return (
    <>
      {/* Left vertical tab bar */}
      <div className="fixed left-0 top-[60px] bottom-0 w-16 border-r border-border bg-background/80 backdrop-blur-md z-10 flex flex-col gap-1 py-2 overflow-y-auto overflow-x-hidden">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            title={tab.label}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 mx-1.5 py-2.5 rounded-lg text-[10px] transition-colors",
              effectiveTab === tab.id
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            )}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
            <span className="leading-none">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content area */}
      {renderContent()}
    </>
  )
}

export default MainLayout
