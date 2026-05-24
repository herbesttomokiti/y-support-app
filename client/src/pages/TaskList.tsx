import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronRight, Clock, CheckCircle2, Circle, ClipboardList, ArrowLeft, User, FileText, Image, Download } from "lucide-react";
import { useLocation } from "wouter";

const statusLabel: Record<string, { label: string; color: string }> = {
  pending: { label: "未着手", color: "bg-muted text-muted-foreground" },
  in_progress: { label: "作業中", color: "bg-primary/10 text-primary" },
  completed: { label: "完了", color: "bg-green-100 text-green-700" },
};

export default function TaskList() {
  const [, navigate] = useLocation();
  // ノーログインで利用可能：全タスクを取得
  const { data: tasks, isLoading } = trpc.tasks.myTasks.useQuery(undefined, {
    refetchInterval: 10000,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allTasks = (tasks ?? []) as any[];
  const pendingTasks = allTasks.filter((t) => t.status !== "completed");
  const completedTasks = allTasks.filter((t) => t.status === "completed");

  return (
    <div className="min-h-screen bg-background">
      {/* ヘッダー */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 py-4">
        <div className="flex items-center gap-3 max-w-2xl mx-auto">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-lg font-bold">今日の作業</h1>
            <p className="text-xs text-muted-foreground">今日の作業一覧</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* 未着手・作業中 */}
        {pendingTasks.length === 0 && completedTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-4 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              <ClipboardList className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">今日の作業はまだありません</p>
            <p className="text-sm text-muted-foreground">管理者が作業を追加するまで待ってください</p>
          </div>
        ) : (
          <>
            {pendingTasks.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide px-1">
                  やること ({pendingTasks.length})
                </h2>
                {pendingTasks.map((task) => {
                  const steps = (task.steps as Array<{ order: number; instruction: string }>) ?? [];
                  const st = statusLabel[task.status] ?? statusLabel.pending;
                  return (
                    <Card
                      key={task.id}
                      className="cursor-pointer hover:shadow-md transition-shadow duration-200 border-border rounded-2xl"
                      onClick={() => navigate(`/tasks/${task.id}/work`)}
                    >
                      <CardContent className="p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>
                                {st.label}
                              </Badge>
                              {task.assignedUserName && (
                                <span className="flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                                  <User className="w-3 h-3" />
                                  {task.assignedUserName}
                                </span>
                              )}
                              {task.clientName && (
                                <span className="text-xs text-muted-foreground">{task.clientName}</span>
                              )}
                            </div>
                            <h3 className="font-bold text-base leading-tight">{task.name}</h3>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" />
                                目安 {task.estimatedMinutes}分
                              </span>
                              <span className="flex items-center gap-1">
                                <Circle className="w-3.5 h-3.5" />
                                {steps.length}ステップ
                              </span>
                            </div>

                          </div>
                          <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-1" />
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {completedTasks.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide px-1">
                  完了済み ({completedTasks.length})
                </h2>
                {completedTasks.map((task) => (
                  <Card key={task.id} className="border-border rounded-2xl opacity-60">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm line-through text-muted-foreground">{task.name}</p>
                          {task.clientName && (
                            <p className="text-xs text-muted-foreground">{task.clientName}</p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
