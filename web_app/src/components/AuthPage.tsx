import { FormEvent, useState } from "react"
import { useStore } from "@/lib/states"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Loader2, LogIn, UserPlus, Wand2 } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"

const AuthPage = () => {
  const { toast } = useToast()
  const [login, register] = useStore((state) => [state.login, state.register])
  const [isRegistering, setIsRegistering] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username || !password) return
    if (isRegistering && !email) return
    setIsLoading(true)
    try {
      if (isRegistering) {
        await register(username, email, password)
        toast({ description: "注册成功，已自动登录！" })
      } else {
        await login(username, password)
        toast({ description: "登录成功！" })
      }
    } catch (err: any) {
      toast({
        variant: "destructive",
        description: err?.response?.data?.detail || err.message || "操作失败，请重试",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[radial-gradient(circle_at_1px_1px,_#8e8e8e8e_1px,_transparent_0)] [background-size:20px_20px]">
      <div className="w-full max-w-sm flex flex-col gap-6 p-8 border border-border rounded-2xl bg-card shadow-lg">
        {/* Logo / Brand */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2 text-primary">
            <Wand2 className="h-8 w-8" />
            <span className="text-2xl font-bold tracking-tight">Artie</span>
          </div>
          <p className="text-sm text-muted-foreground">AI 图像编辑与生成工作台</p>
        </div>

        {/* Tab switch */}
        <div className="flex rounded-lg bg-muted p-1 gap-1">
          <button
            type="button"
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              !isRegistering ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setIsRegistering(false)}
          >
            登录
          </button>
          <button
            type="button"
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              isRegistering ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setIsRegistering(true)}
          >
            注册
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="auth-username">用户名</Label>
            <Input
              id="auth-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
              autoComplete="username"
              autoFocus
            />
          </div>

          {isRegistering && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="auth-email">邮箱</Label>
              <Input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="请输入邮箱地址"
                autoComplete="email"
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="auth-password">密码</Label>
            <Input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              autoComplete={isRegistering ? "new-password" : "current-password"}
            />
          </div>

          <Button type="submit" className="w-full gap-2 mt-2" disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isRegistering ? (
              <UserPlus className="h-4 w-4" />
            ) : (
              <LogIn className="h-4 w-4" />
            )}
            {isRegistering ? "注册并登录" : "登录"}
          </Button>
        </form>

        <p className="text-xs text-center text-muted-foreground">
          {isRegistering ? "注册即表示您同意我们的服务条款" : "登录后可保存您的创作到个人工作空间"}
        </p>
      </div>
    </div>
  )
}

export default AuthPage
