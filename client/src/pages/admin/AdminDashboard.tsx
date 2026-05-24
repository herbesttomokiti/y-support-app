import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useLocation } from "wouter";
import { Loader2, Plus, BarChart2, BookTemplate, ClipboardList, ArrowLeft, Users, Trash2, User, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export default function AdminDashboard() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { data: tasks, refetch: refetchTasks } = trpc.tasks.allTasks.useQuery(undefined, { enabled: user?.role === "admin" });
  const { data: sessions } = trpc.sessions.allActive.useQuery(undefined, { enabled: user?.role === "admin" });
  const deleteTask = trpc.tasks.delete.useMutation({
    onSuccess: () => {
      toast.success("作業カードを削除しました");
      utils.tasks.allTasks.invalidate();
      utils.tasks.myTasks.invalidate();
    },
    onError: () => toast.error("削除に失敗しました"),
  });

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!user || user.role !== "admin") return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">管理者権限が必要です</p></div>;

  const pendingCount = tasks?.filter(t => t.status === "pending").length ?? 0;
  const inProgressCount = tasks?.filter(t => t.status === "in_progress").length ?? 0;
  const completedCount = tasks?.filter(t => t.status === "completed").length ?? 0;
  const activeSessionCount = sessions?.filter(s => !s.completedAt).length ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background px-4 py-4 neu-sm" style={{borderRadius: 0}}>
        <div className="flex items-center gap-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-lg font-bold">管理者メニュー</h1>
            <p className="text-xs text-muted-foreground">{user.name}</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* サマリーカード */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "未着手", value: pendingCount, color: "text-muted-foreground" },
            { label: "作業中", value: inProgressCount, color: "text-primary" },
            { label: "完了", value: completedCount, color: "text-green-600" },
            { label: "アクティブ", value: activeSessionCount, color: "text-amber-600" },
          ].map((item) => (
            <Card key={item.label} className="rounded-2xl border-0">
              <CardContent className="p-4 text-center">
                <p className={`text-3xl font-bold ${item.color}`}>{item.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{item.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* メニュー */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card
            className="rounded-2xl border-0 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate("/admin/tasks/create")}
          >
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Plus className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="font-bold">作業カードを作成</h3>
                <p className="text-xs text-muted-foreground mt-0.5">AIが自動でステップに分解</p>
              </div>
            </CardContent>
          </Card>

          <Card
            className="rounded-2xl border-0 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate("/admin/progress")}
          >
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                <BarChart2 className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <h3 className="font-bold">進捗確認</h3>
                <p className="text-xs text-muted-foreground mt-0.5">リアルタイムで状況を把握</p>
              </div>
            </CardContent>
          </Card>

          <Card
            className="rounded-2xl border-0 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate("/admin/templates")}
          >
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                <BookTemplate className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <h3 className="font-bold">テンプレート管理</h3>
                <p className="text-xs text-muted-foreground mt-0.5">よく使う作業を保存</p>
              </div>
            </CardContent>
          </Card>

          <Card
            className="rounded-2xl border-0 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate("/tasks")}
          >
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
                <ClipboardList className="w-6 h-6 text-secondary-foreground" />
              </div>
              <div>
                <h3 className="font-bold">作業確認</h3>
                <p className="text-xs text-muted-foreground mt-0.5">作業画面を確認</p>
              </div>
            </CardContent>
          </Card>

          <Card
            className="rounded-2xl border-0 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate("/admin/records")}
          >
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h3 className="font-bold">作業記録・CSV出力</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Googleスプレッドシートに書き出し</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 最近のタスク */}
        {tasks && tasks.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide px-1">最近の作業カード</h2>
            {tasks.slice(0, 10).map((task) => (
              <Card key={task.id} className="rounded-xl border-0">
                <CardContent className="p-4 flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{task.name}</p>
                    <div className="flex items-center gap-2 flex-wrap mt-0.5">
                      {(task as any).assignedUserName && (
                        <span className="flex items-center gap-1 text-xs font-medium text-primary">
                          <User className="w-3 h-3" />
                          {(task as any).assignedUserName}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">{task.clientName ?? "—"} · {task.estimatedMinutes}分</span>
                      {(task as any).totalPanicCount > 0 && (
                        <span className="flex items-center gap-0.5 text-xs font-medium text-amber-600">
                          <AlertTriangle className="w-3 h-3" />
                          {(task as any).totalPanicCount}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium flex-shrink-0 ${
                    task.status === "completed" ? "bg-green-100 text-green-700" :
                    task.status === "in_progress" ? "bg-primary/10 text-primary" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {task.status === "completed" ? "完了" : task.status === "in_progress" ? "作業中" : "未着手"}
                  </span>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="flex-shrink-0 text-muted-foreground hover:text-destructive"
                        disabled={deleteTask.isPending}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>作業カードを削除しますか？</AlertDialogTitle>
                        <AlertDialogDescription>
                          「{task.name}」を削除します。この操作は元に戻せません。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>キャンセル</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => deleteTask.mutate({ id: task.id })}
                        >
                          削除する
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
