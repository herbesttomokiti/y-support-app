import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { Loader2, ArrowLeft, Clock, AlertTriangle, RefreshCw, CheckCircle2, Activity } from "lucide-react";
import { useState } from "react";

interface Step {
  order: number;
  instruction: string;
  checkItems: string[];
}

export default function AdminProgress() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);

  const {
    data: sessions,
    isLoading,
    refetch,
    isFetching,
  } = trpc.sessions.allActive.useQuery(undefined, {
    enabled: user?.role === "admin",
    refetchInterval: 15000,
  });

  const { data: completions } = trpc.sessions.completionsBySession.useQuery(
    { sessionId: selectedSessionId! },
    { enabled: !!selectedSessionId }
  );

  if (!user || user.role !== "admin") {
    return <div className="min-h-screen flex items-center justify-center"><p>管理者権限が必要です</p></div>;
  }

  const activeSessions = sessions?.filter((s) => !s.completedAt) ?? [];
  const recentCompleted = sessions?.filter((s) => s.completedAt).slice(0, 5) ?? [];

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-4">
        <div className="flex items-center justify-between max-w-3xl mx-auto">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-lg font-bold">進捗確認</h1>
              <p className="text-xs text-muted-foreground">15秒ごとに自動更新</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* アクティブセッション */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <Activity className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  作業中 ({activeSessions.length})
                </h2>
              </div>

              {activeSessions.length === 0 ? (
                <Card className="rounded-2xl border-border">
                  <CardContent className="p-8 text-center">
                    <p className="text-muted-foreground text-sm">現在作業中のスタッフはいません</p>
                  </CardContent>
                </Card>
              ) : (
                activeSessions.map((session) => {
                  const task = session.task;
                  const steps: Step[] = (task?.steps as Step[]) ?? [];
                  const totalSteps = steps.length;
                  const currentStep = session.currentStepOrder;
                  const progressPct = totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0;
                  const startedAt = new Date(session.startedAt);
                  const elapsedMinutes = Math.floor((Date.now() - startedAt.getTime()) / 60000);
                  const estimatedMinutes = task?.estimatedMinutes ?? 30;
                  const isOvertime = elapsedMinutes > estimatedMinutes;

                  return (
                    <Card
                      key={session.id}
                      className={`rounded-2xl border-2 cursor-pointer transition-all ${
                        selectedSessionId === session.id
                          ? "border-primary shadow-md"
                          : "border-border hover:border-primary/50"
                      }`}
                      onClick={() =>
                        setSelectedSessionId(
                          selectedSessionId === session.id ? null : session.id
                        )
                      }
                    >
                      <CardContent className="p-5 space-y-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge className="bg-primary/10 text-primary text-xs">作業中</Badge>
                              {task?.clientName && (
                                <span className="text-xs text-muted-foreground">{task.clientName}</span>
                              )}
                            </div>
                            <h3 className="font-bold mt-1 leading-tight">{task?.name ?? "不明"}</h3>
                          </div>
                          {/* 「迷ったら押す」使用回数 */}
                          {session.panicButtonCount > 0 && (
                            <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 flex-shrink-0">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                              <span className="text-xs font-bold text-amber-700">
                                {session.panicButtonCount}回
                              </span>
                            </div>
                          )}
                        </div>

                        {/* 進捗バー */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>ステップ {currentStep} / {totalSteps}</span>
                            <span>{Math.round(progressPct)}%</span>
                          </div>
                          <Progress value={progressPct} className="h-2" />
                        </div>

                        {/* 時間情報 */}
                        <div className="flex items-center gap-4 text-sm">
                          <div className={`flex items-center gap-1.5 ${isOvertime ? "text-destructive" : "text-muted-foreground"}`}>
                            <Clock className="w-3.5 h-3.5" />
                            <span>経過 {elapsedMinutes}分 / 目安 {estimatedMinutes}分</span>
                            {isOvertime && <span className="font-bold">（超過）</span>}
                          </div>
                        </div>

                        {/* 現在のステップ */}
                        {steps[currentStep] && (
                          <div className="bg-primary/5 rounded-xl p-3">
                            <p className="text-xs text-muted-foreground mb-1">現在のステップ</p>
                            <p className="text-sm font-medium">{steps[currentStep].instruction}</p>
                          </div>
                        )}

                        {/* 展開：完了ステップのメモ */}
                        {selectedSessionId === session.id && completions && completions.length > 0 && (
                          <div className="border-t pt-4 space-y-3">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                              完了済みステップのメモ
                            </p>
                            {completions.map((c) => (
                              <div key={c.id} className="space-y-1">
                                <p className="text-xs text-muted-foreground">
                                  Step {c.stepOrder} — {new Date(c.completedAt).toLocaleTimeString("ja-JP")}
                                </p>
                                {c.memoImageUrl && (
                                  <img
                                    src={c.memoImageUrl}
                                    alt={`Step ${c.stepOrder} メモ`}
                                    className="rounded-lg border border-border max-h-32 object-contain bg-white"
                                  />
                                )}
                                {c.memoText && (
                                  <p className="text-sm text-foreground">{c.memoText}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>

            {/* 最近の完了 */}
            {recentCompleted.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    最近の完了
                  </h2>
                </div>
                {recentCompleted.map((session) => {
                  const task = session.task;
                  return (
                    <Card key={session.id} className="rounded-xl border-border opacity-75">
                      <CardContent className="p-4 flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{task?.name ?? "不明"}</p>
                          <p className="text-xs text-muted-foreground">
                            {session.actualMinutes ? `実績 ${session.actualMinutes}分` : ""}
                            {session.panicButtonCount > 0 ? ` · 迷い ${session.panicButtonCount}回` : ""}
                          </p>
                        </div>
                        <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 ml-3" />
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
