import { useEffect, useMemo, useState } from "react"
import { useStore } from "@/lib/states"
import { Button, ImageUploadButton } from "../ui/button"
import { Input } from "../ui/input"
import { Loader2, Upload, FolderOpen, Play, Trash2, Clock3 } from "lucide-react"
import { useToast } from "../ui/use-toast"
import { getAssetFileUrl } from "@/lib/api"
import { cn } from "@/lib/utils"

const MyWorkspaceTab = () => {
  const { toast } = useToast()
  const [
    workspaceItems,
    workspaceDetail,
    isLoadingWorkspaces,
    isLoadingWorkspaceDetail,
    fetchWorkspaces,
    fetchWorkspaceDetail,
    resumeWorkspace,
    deleteWorkspaceItem,
    importFileToWorkspace,
  ] = useStore((state) => [
    state.workspaceItems,
    state.workspaceDetail,
    state.isLoadingWorkspaces,
    state.isLoadingWorkspaceDetail,
    state.fetchWorkspaces,
    state.fetchWorkspaceDetail,
    state.resumeWorkspace,
    state.deleteWorkspaceItem,
    state.importFileToWorkspace,
  ])

  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    fetchWorkspaces()
  }, [fetchWorkspaces])

  useEffect(() => {
    if (selectedId) {
      fetchWorkspaceDetail(selectedId)
    }
  }, [fetchWorkspaceDetail, selectedId])

  const items = useMemo(() => {
    if (!search.trim()) return workspaceItems
    const text = search.trim().toLowerCase()
    return workspaceItems.filter((item) => item.title.toLowerCase().includes(text))
  }, [search, workspaceItems])

  const handleOpen = async (id: string) => {
    try {
      await resumeWorkspace(id)
    } catch (e: any) {
      toast({
        variant: "destructive",
        description: e.message ? e.message : e.toString(),
      })
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteWorkspaceItem(id)
      if (selectedId === id) {
        setSelectedId(null)
      }
    } catch (e: any) {
      toast({
        variant: "destructive",
        description: e.message ? e.message : e.toString(),
      })
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-[360px] border-r border-border flex flex-col">
        <div className="p-4 border-b border-border flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            <div className="text-sm font-medium">我的作品</div>
          </div>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索保存的工作…"
          />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => fetchWorkspaces(search)}>
              刷新
            </Button>
            <ImageUploadButton
              tooltip="上传图片并创建工作"
              onFileUpload={(file) => void importFileToWorkspace(file)}
            >
              <Upload className="h-4 w-4 mr-2" />
              上传新图片
            </ImageUploadButton>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {isLoadingWorkspaces ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
              <FolderOpen className="h-10 w-10 opacity-30" />
              <p className="text-sm">还没有保存的工作</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {items.map((item) => (
                <button
                  key={item.id}
                  className={cn(
                    "text-left rounded-xl border p-3 transition-colors bg-card hover:bg-accent/30",
                    selectedId === item.id && "border-primary"
                  )}
                  onClick={() => setSelectedId(item.id)}
                >
                  <div className="aspect-[4/3] rounded-lg overflow-hidden bg-muted mb-3">
                    {item.preview_asset_id ? (
                      <img
                        src={getAssetFileUrl(item.preview_asset_id)}
                        alt={item.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                        无预览
                      </div>
                    )}
                  </div>
                  <div className="font-medium text-sm line-clamp-2">{item.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {item.current_feature}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-2">
                    <Clock3 className="h-3 w-3" />
                    {new Date(item.updated_at).toLocaleString()}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!selectedId ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            选择左侧一条保存记录查看详情
          </div>
        ) : isLoadingWorkspaceDetail || !workspaceDetail ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="p-6 flex flex-col gap-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xl font-semibold">{workspaceDetail.session.title}</div>
                <div className="text-sm text-muted-foreground mt-1">
                  当前功能: {workspaceDetail.session.current_feature}
                </div>
                {workspaceDetail.latest_snapshot && (
                  <div className="text-sm text-muted-foreground">
                    最近保存: {new Date(workspaceDetail.latest_snapshot.created_at).toLocaleString()}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button onClick={() => handleOpen(workspaceDetail.session.id)} className="gap-2">
                  <Play className="h-4 w-4" />
                  继续编辑
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => handleDelete(workspaceDetail.session.id)}
                  className="gap-2"
                >
                  <Trash2 className="h-4 w-4" />
                  删除
                </Button>
              </div>
            </div>

            {workspaceDetail.latest_snapshot?.preview_asset_id && (
              <div className="rounded-xl overflow-hidden border border-border bg-card">
                <img
                  src={getAssetFileUrl(workspaceDetail.latest_snapshot.preview_asset_id)}
                  alt={workspaceDetail.session.title}
                  className="w-full max-h-[420px] object-contain bg-muted/20"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-6">
              <div className="rounded-xl border border-border p-4 bg-card">
                <div className="font-medium mb-3">功能状态</div>
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all">
                  {JSON.stringify(workspaceDetail.feature_states, null, 2)}
                </pre>
              </div>
              <div className="rounded-xl border border-border p-4 bg-card">
                <div className="font-medium mb-3">最近快照</div>
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all">
                  {JSON.stringify(workspaceDetail.latest_snapshot?.workspace_state ?? {}, null, 2)}
                </pre>
              </div>
            </div>

            <div className="rounded-xl border border-border p-4 bg-card">
              <div className="font-medium mb-3">操作记录</div>
              {workspaceDetail.operations.length === 0 ? (
                <div className="text-sm text-muted-foreground">暂无操作记录</div>
              ) : (
                <div className="flex flex-col gap-3">
                  {workspaceDetail.operations.map((operation) => (
                    <div key={operation.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium text-sm">
                          {operation.feature} / {operation.operation}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(operation.started_at).toLocaleString()}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        状态: {operation.status}
                        {operation.model_name ? ` | 模型: ${operation.model_name}` : ""}
                        {operation.plugin_name ? ` | 插件: ${operation.plugin_name}` : ""}
                        {operation.duration_ms ? ` | ${operation.duration_ms}ms` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default MyWorkspaceTab
