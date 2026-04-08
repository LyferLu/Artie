import { useEffect, useState } from "react"
import { useStore } from "@/lib/states"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Loader2, Plus, Trash2, Edit2, FolderOpen, Image as ImageIcon } from "lucide-react"
import { useToast } from "../ui/use-toast"
import { WorkspaceTab } from "@/lib/types"
import { getImageFileUrl } from "@/lib/api"
import { cn } from "@/lib/utils"

const IMAGE_TYPE_LABELS: Record<string, string> = {
  all: "全部",
  generated: "文生图",
  inpainted: "修复",
  enhanced: "增强",
  uploaded: "上传",
}

const WorkspaceContent = () => {
  const { toast } = useToast()
  const [
    projects,
    currentProject,
    projectImages,
    isLoadingProjects,
    isLoadingImages,
    fetchProjects,
    createUserProject,
    deleteUserProject,
    setCurrentProject,
    fetchProjectImages,
    deleteUserImage,
    setActiveTab,
    setFile,
  ] = useStore((state) => [
    state.projects,
    state.currentProject,
    state.projectImages,
    state.isLoadingProjects,
    state.isLoadingImages,
    state.fetchProjects,
    state.createUserProject,
    state.deleteUserProject,
    state.setCurrentProject,
    state.fetchProjectImages,
    state.deleteUserImage,
    state.setActiveTab,
    state.setFile,
  ])

  const [newProjectName, setNewProjectName] = useState("")
  const [filterType, setFilterType] = useState<string | undefined>(undefined)

  useEffect(() => {
    fetchProjects()
  }, [])

  useEffect(() => {
    if (currentProject) {
      fetchProjectImages(currentProject.id, filterType)
    } else {
      fetchProjectImages(undefined, filterType)
    }
  }, [currentProject, filterType])

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return
    try {
      await createUserProject(newProjectName.trim())
      setNewProjectName("")
    } catch (e: any) {
      toast({ variant: "destructive", description: e.message })
    }
  }

  const handleDeleteProject = async (id: string) => {
    try {
      await deleteUserProject(id)
    } catch (e: any) {
      toast({ variant: "destructive", description: e.message })
    }
  }

  const handleEditImage = async (imageId: string) => {
    try {
      const url = getImageFileUrl(imageId)
      const res = await fetch(url)
      const blob = await res.blob()
      const file = new File([blob], `image_${imageId}.png`, { type: "image/png" })
      await setFile(file)
      setActiveTab(WorkspaceTab.INPAINT)
    } catch {
      toast({ variant: "destructive", description: "加载图片失败，请重试" })
    }
  }

  const handleDeleteImage = async (id: string) => {
    try {
      await deleteUserImage(id)
    } catch (e: any) {
      toast({ variant: "destructive", description: e.message })
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左侧：项目列表 */}
      <div className="w-56 border-r border-border flex flex-col gap-2 p-3 overflow-y-auto shrink-0">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">项目</div>
        <div className="flex gap-1">
          <Input
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder="新建项目…"
            className="h-7 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateProject()
            }}
          />
          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={handleCreateProject}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        <button
          className={cn(
            "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left",
            !currentProject ? "bg-accent" : "hover:bg-accent/50"
          )}
          onClick={() => setCurrentProject(null)}
        >
          <FolderOpen className="h-4 w-4 shrink-0" />
          <span className="truncate">所有图片</span>
        </button>

        {isLoadingProjects ? (
          <div className="flex justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          projects.map((p) => (
            <div
              key={p.id}
              className={cn(
                "group flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors cursor-pointer",
                currentProject?.id === p.id ? "bg-accent" : "hover:bg-accent/50"
              )}
              onClick={() => setCurrentProject(p)}
            >
              <FolderOpen className="h-4 w-4 shrink-0" />
              <span className="truncate flex-1">{p.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">{p.image_count}</span>
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeleteProject(p.id)
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))
        )}
      </div>

      {/* 右侧：图片列表 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
          <span className="text-sm font-medium">
            {currentProject ? currentProject.name : "所有图片"}
          </span>
          <div className="ml-auto flex gap-1">
            {(["all", "generated", "inpainted", "enhanced", "uploaded"] as const).map((type) => (
              <button
                key={type}
                className={cn(
                  "px-2 py-0.5 rounded text-xs transition-colors",
                  (type === "all" ? !filterType : filterType === type)
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setFilterType(type === "all" ? undefined : type)}
              >
                {IMAGE_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {isLoadingImages ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : projectImages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
              <ImageIcon className="h-12 w-12 opacity-30" />
              <p className="text-sm">暂无图片</p>
              <p className="text-xs">生成或修复图片后将显示在此处</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {projectImages.map((img) => (
                <div
                  key={img.id}
                  className="group relative rounded-lg overflow-hidden border border-border bg-muted aspect-square"
                >
                  <img
                    src={getImageFileUrl(img.id)}
                    alt={img.filename}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2 gap-1">
                    <Button
                      size="sm"
                      className="gap-1 text-xs h-7 flex-1"
                      onClick={() => handleEditImage(img.id)}
                    >
                      <Edit2 className="h-3 w-3" />
                      编辑
                    </Button>
                    <Button
                      size="icon"
                      variant="destructive"
                      className="h-7 w-7 shrink-0"
                      onClick={() => handleDeleteImage(img.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="absolute top-1 left-1 bg-black/60 text-white text-[9px] px-1 py-0.5 rounded capitalize">
                    {IMAGE_TYPE_LABELS[img.image_type] ?? img.image_type}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const MyWorkspaceTab = () => {
  return <WorkspaceContent />
}

export default MyWorkspaceTab
