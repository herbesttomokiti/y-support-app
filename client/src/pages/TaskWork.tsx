import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import HandwritingCanvas from "@/components/HandwritingCanvas";
import { useLocation, useParams } from "wouter";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  Loader2,
  ArrowLeft,
  Clock,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Copy,
  Check,
  FileText,
  Image,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

interface Step {
  order: number;
  instruction: string;
  checkItems: string[];
}

// ── タイマーフック ──────────────────────────────────────────────────────────
function useTimer(estimatedMinutes: number, onWarning: () => void) {
  const [elapsed, setElapsed] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const startTimeRef = useRef<number | null>(null);
  const warningFiredRef = useRef(false);
  const totalSeconds = estimatedMinutes * 60;

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => {
      if (startTimeRef.current === null) return;
      const e = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsed(e);
      // 残り2分で警告
      if (!warningFiredRef.current && totalSeconds - e <= 120 && totalSeconds - e > 0) {
        warningFiredRef.current = true;
        onWarning();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [isRunning, totalSeconds, onWarning]);

  const start = useCallback(() => {
    startTimeRef.current = Date.now();
    setIsRunning(true);
  }, []);

  const stop = useCallback(() => {
    setIsRunning(false);
    return startTimeRef.current ? Math.floor((Date.now() - startTimeRef.current) / 1000 / 60) : 0;
  }, []);

  const remaining = Math.max(0, totalSeconds - elapsed);
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const isOvertime = elapsed > totalSeconds;
  const progressPct = Math.min(100, (elapsed / totalSeconds) * 100);

  return { elapsed, remaining, minutes, seconds, isOvertime, progressPct, start, stop, isRunning };
}

// ── メインコンポーネント ────────────────────────────────────────────────────
export default function TaskWork() {
  const { id } = useParams<{ id: string }>();
  const taskId = parseInt(id ?? "0");
  const [, navigate] = useLocation();

  // State
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [hasCanvasContent, setHasCanvasContent] = useState(false);
  const [getImageData, setGetImageData] = useState<(() => string | null) | null>(null);
  const [clearCanvas, setClearCanvas] = useState<(() => void) | null>(null);
  const [isPanicMode, setIsPanicMode] = useState(false);
  const [phase, setPhase] = useState<"preview" | "working" | "completed">("preview");
  const [reportText, setReportText] = useState("");
  const [copied, setCopied] = useState(false);
  const [isCompletingStep, setIsCompletingStep] = useState(false);

  // Queries
  const { data: task, isLoading: taskLoading } = trpc.tasks.getById.useQuery(
    { id: taskId },
    { enabled: !!taskId }
  );
  const { data: prevLog } = trpc.sessions.previousLog.useQuery(
    { taskId },
    { enabled: !!taskId }
  );

  const steps: Step[] = (task?.steps as Step[]) ?? [];
  const currentStep = steps[currentStepIndex];

  // Timer
  const handleTimerWarning = useCallback(() => {
    toast.warning("⏰ 残り2分です！急いで確認してください", { duration: 5000 });
  }, []);
  const timer = useTimer(task?.estimatedMinutes ?? 30, handleTimerWarning);

  // Mutations
  const startSession = trpc.sessions.start.useMutation();
  const updateProgress = trpc.sessions.updateProgress.useMutation();
  const panicButtonMutation = trpc.sessions.panicButton.useMutation();
  const completeStep = trpc.sessions.completeStep.useMutation();
  const completeSession = trpc.sessions.complete.useMutation();
  const generateReport = trpc.llm.generateReport.useMutation();
  const utils = trpc.useUtils();

  // 作業開始
  const handleStart = async () => {
    if (!task) return;
    try {
      const session = await startSession.mutateAsync({ taskId });
      if (session) {
        setSessionId(session.id);
        setCurrentStepIndex(0);
        setPhase("working");
        timer.start();
      }
    } catch {
      toast.error("作業の開始に失敗しました");
    }
  };

  // 「迷ったら押す」
  const handlePanic = async () => {
    if (!sessionId) return;
    setIsPanicMode(true);
    await panicButtonMutation.mutateAsync({ sessionId });
    setTimeout(() => setIsPanicMode(false), 8000);
  };

  // ステップ完了
  const handleCompleteStep = async () => {
    if (!sessionId || !currentStep) return;
    setIsCompletingStep(true);
    try {
      const imageData = getImageData?.() ?? null;
      await completeStep.mutateAsync({
        sessionId,
        taskId,
        stepOrder: currentStep.order,
        memoImageBase64: imageData ?? undefined,
      });

      const nextIndex = currentStepIndex + 1;
      if (nextIndex >= steps.length) {
        // 全ステップ完了 → 報告テンプレ生成
        const actualMinutes = timer.stop();
        setPhase("completed");
        try {
          const report = await generateReport.mutateAsync({
            taskName: task?.name ?? "",
            clientName: task?.clientName ?? undefined,
            steps,
            stepMemos: [],
            actualMinutes: actualMinutes ?? undefined,
            estimatedMinutes: task?.estimatedMinutes ?? undefined,
          });
          const reportStr = typeof report === "string" ? report : "";
          setReportText(reportStr);
          await completeSession.mutateAsync({
            sessionId,
            taskId,
            actualMinutes: actualMinutes ?? undefined,
            reportText: reportStr,
          });
        } catch {
          await completeSession.mutateAsync({ sessionId, taskId, actualMinutes: actualMinutes ?? undefined });
        }
        utils.tasks.myTasks.invalidate();
      } else {
        await updateProgress.mutateAsync({ sessionId, currentStepOrder: nextIndex });
        setCurrentStepIndex(nextIndex);
        setCheckedItems({});
        setHasCanvasContent(false);
        // ステップ切り替わり時に手書きメモを自動全削除
        clearCanvas?.();
      }
    } catch {
      toast.error("ステップの完了に失敗しました");
    } finally {
      setIsCompletingStep(false);
    }
  };

  const handleCopyReport = () => {
    navigator.clipboard.writeText(reportText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("報告文をコピーしました");
  };

  const allChecksDone =
    !currentStep ||
    currentStep.checkItems.length === 0 ||
    currentStep.checkItems.every((_, i) => checkedItems[`${currentStep.order}-${i}`]);

  // メモは任意なのでチェック項目のみ必須
  const canComplete = allChecksDone;

  if (taskLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">作業が見つかりません</p>
      </div>
    );
  }

  // ── パニックモード ──────────────────────────────────────────────────────
  if (isPanicMode && currentStep) {
    return (
      <div className="min-h-screen bg-amber-50 flex flex-col items-center justify-center px-6 text-center">
        <div className="max-w-sm w-full space-y-8">
          <div className="space-y-4">
            <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-8 h-8 text-amber-600" />
            </div>
            <h2 className="text-xl font-bold text-amber-900">今やること</h2>
          </div>
          <div className="bg-white rounded-2xl p-6 shadow-lg border border-amber-200">
            <p className="text-2xl font-bold text-foreground leading-relaxed">
              {currentStep.instruction}
            </p>
          </div>
          <Button
            size="lg"
            className="w-full h-14 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold"
            onClick={() => setIsPanicMode(false)}
          >
            わかった、戻る
          </Button>
        </div>
      </div>
    );
  }

  // ── 完了画面 ────────────────────────────────────────────────────────────
  if (phase === "completed") {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
          <div className="text-center space-y-4">
            <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <h1 className="text-2xl font-bold">作業完了！</h1>
            <p className="text-muted-foreground">お疲れ様でした。報告文をコピーして送信してください。</p>
          </div>

          {reportText && (
            <Card className="rounded-2xl border-border">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">報告文</h3>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCopyReport}
                    className="rounded-xl"
                  >
                    {copied ? (
                      <><Check className="w-4 h-4 mr-1 text-green-500" />コピー済み</>
                    ) : (
                      <><Copy className="w-4 h-4 mr-1" />コピー</>
                    )}
                  </Button>
                </div>
                <pre className="text-sm text-foreground whitespace-pre-wrap leading-relaxed bg-muted/50 rounded-xl p-4">
                  {reportText}
                </pre>
              </CardContent>
            </Card>
          )}

          {generateReport.isPending && (
            <div className="flex items-center justify-center gap-2 text-muted-foreground py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">報告文を生成中...</span>
            </div>
          )}

          <Button
            size="lg"
            className="w-full h-14 rounded-2xl font-bold"
            onClick={() => navigate("/tasks")}
          >
            作業一覧に戻る
          </Button>
        </div>
      </div>
    );
  }

  // ── プレビュー画面（前回ログ + 開始ボタン）─────────────────────────────
  if (phase === "preview") {
    return (
      <div className="min-h-screen bg-background">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-4">
          <div className="flex items-center gap-3 max-w-2xl mx-auto">
            <Button variant="ghost" size="icon" onClick={() => navigate("/tasks")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-base font-bold leading-tight">{task.name}</h1>
              {task.clientName && <p className="text-xs text-muted-foreground">{task.clientName}</p>}
            </div>
          </div>
        </div>

        <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
          {/* 作業概要 */}
          <Card className="rounded-2xl border-border">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="w-4 h-4" />
                <span>目安時間：{task.estimatedMinutes}分</span>
                <span>·</span>
                <span>{steps.length}ステップ</span>
              </div>
              {task.description && (
                <p className="text-sm text-foreground leading-relaxed">{task.description}</p>
              )}
            </CardContent>
          </Card>

          {/* 前回ログ */}
          {prevLog && prevLog.length > 0 && (
            <Card className="rounded-2xl border-amber-200 bg-amber-50">
              <CardContent className="p-5 space-y-3">
                <h3 className="font-semibold text-amber-900 text-sm">📝 前回のメモ（思い出し用）</h3>
                <div className="space-y-2">
                  {prevLog.map((log) => (
                    <div key={log.id} className="text-sm text-amber-800">
                      <span className="font-medium">Step {log.stepOrder}：</span>
                      {log.memoText && <span>{log.memoText}</span>}
                      {log.memoImageUrl && (
                        <img
                          src={log.memoImageUrl}
                          alt={`Step ${log.stepOrder} メモ`}
                          className="mt-1 rounded-lg border border-amber-200 max-h-24 object-contain"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* 指示書ファイル */}
          {task.instructionFileName && task.instructionFileUrl && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground px-1">指示書</h3>
              {task.instructionFileType === "image" ? (
                // 画像はインラインプレビュー
                <div className="rounded-2xl overflow-hidden border border-border">
                  <img
                    src={task.instructionFileUrl}
                    alt={task.instructionFileName}
                    className="w-full object-contain max-h-64"
                  />
                  <div className="px-4 py-2 bg-muted/30 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{task.instructionFileName}</span>
                    <a
                      href={task.instructionFileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary flex items-center gap-1"
                    >
                      別タブで開く <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              ) : task.instructionFileType === "excel" ? (
                // ExcelはGoogle Docs Viewerでインライン表示
                <div className="rounded-2xl overflow-hidden border border-border">
                  <div className="px-4 py-2 bg-muted/30 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <FileText className="w-3.5 h-3.5" />
                      {task.instructionFileName}
                    </span>
                    <a
                      href={task.instructionFileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary flex items-center gap-1"
                    >
                      別タブで開く <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <iframe
                    src={`https://docs.google.com/gview?url=${encodeURIComponent(`${window.location.origin}${task.instructionFileUrl}`)}&embedded=true`}
                    className="w-full h-72 border-0"
                    title={task.instructionFileName}
                  />
                </div>
              ) : (
                // PDFはiframeインライン表示
                <div className="rounded-2xl overflow-hidden border border-border">
                  <div className="px-4 py-2 bg-muted/30 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <FileText className="w-3.5 h-3.5" />
                      {task.instructionFileName}
                    </span>
                    <a
                      href={task.instructionFileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary flex items-center gap-1"
                    >
                      別タブで開く <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <iframe
                    src={`${task.instructionFileUrl}#toolbar=0&navpanes=0`}
                    className="w-full h-72 border-0"
                    title={task.instructionFileName}
                  />
                </div>
              )}
            </div>
          )}

          {/* ステップ一覧プレビュー */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground px-1">作業の流れ</h3>
            {steps.map((step, i) => (
              <div key={step.order} className="flex items-start gap-3 px-2 py-2">
                <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-muted-foreground">{i + 1}</span>
                </div>
                <p className="text-sm text-foreground leading-relaxed">{step.instruction}</p>
              </div>
            ))}
          </div>

          <Button
            size="lg"
            className="w-full h-16 text-lg font-bold rounded-2xl shadow-md"
            onClick={handleStart}
            disabled={startSession.isPending}
          >
            {startSession.isPending ? (
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
            ) : null}
            作業を開始する
          </Button>
        </div>
      </div>
    );
  }

  // ── 作業中画面 ──────────────────────────────────────────────────────────
  const hasFile = !!(task.instructionFileName && task.instructionFileUrl);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ヘッダー */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-3">
        <div className="max-w-full mx-auto space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">{task.clientName}</p>
              <h1 className="text-sm font-bold leading-tight">{task.name}</h1>
            </div>
            {/* タイマー */}
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold ${
                timer.isOvertime
                  ? "bg-destructive/10 text-destructive"
                  : timer.remaining <= 120
                  ? "bg-amber-100 text-amber-700"
                  : "bg-primary/10 text-primary"
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              {timer.isOvertime ? "+" : ""}
              {String(timer.minutes).padStart(2, "0")}:{String(timer.seconds).padStart(2, "0")}
            </div>
          </div>
          {/* 進捗バー */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>ステップ {currentStepIndex + 1} / {steps.length}</span>
              <span>{Math.round(((currentStepIndex) / steps.length) * 100)}%</span>
            </div>
            <Progress value={(currentStepIndex / steps.length) * 100} className="h-2" />
          </div>
        </div>
      </div>

      {/* メインコンテンツ：原稿ありの場合は左右分割 */}
      <div className={`flex-1 flex ${hasFile ? "lg:flex-row flex-col" : ""} overflow-hidden`}>

        {/* 左ペイン：原稿プレビュー */}
        {hasFile && (
          <div className="lg:w-[45%] lg:sticky lg:top-[89px] lg:h-[calc(100vh-89px)] border-b lg:border-b-0 lg:border-r border-border flex flex-col">
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                原稿
              </p>
              <a
                href={task.instructionFileUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary flex items-center gap-1"
              >
                別タブで開く <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="flex-1 px-3 pb-4 overflow-hidden">
              {task.instructionFileType === "image" ? (
                <img
                  src={task.instructionFileUrl!}
                  alt={task.instructionFileName!}
                  className="w-full rounded-xl object-contain"
                />
              ) : task.instructionFileType === "excel" ? (
                <iframe
                  src={`https://docs.google.com/gview?url=${encodeURIComponent(`${window.location.origin}${task.instructionFileUrl}`)}&embedded=true`}
                  className="w-full h-[280px] lg:h-full rounded-xl border-0"
                  title={task.instructionFileName!}
                />
              ) : (
                <iframe
                  src={`${task.instructionFileUrl}#toolbar=0&navpanes=0`}
                  className="w-full h-[280px] lg:h-full rounded-xl border-0"
                  title={task.instructionFileName!}
                />
              )}
            </div>
          </div>
        )}

        {/* 右ペイン：ステップ内容 */}
        <div className={`${hasFile ? "lg:flex-1 lg:overflow-y-auto" : "max-w-2xl mx-auto w-full"} flex flex-col`}>
        <div className="px-4 py-6 space-y-6">
        {/* ステップカード */}
        {currentStep && (
          <Card className="rounded-2xl border-primary/30 shadow-md step-enter">
            <CardContent className="p-6 space-y-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                  <span className="text-primary-foreground font-bold text-sm">{currentStep.order}</span>
                </div>
                <div className="flex-1">
                  <p className="text-lg font-bold leading-relaxed text-foreground">
                    {currentStep.instruction}
                  </p>
                </div>
              </div>

              {/* チェックリスト */}
              {currentStep.checkItems.length > 0 && (
                <div className="space-y-2 pl-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">確認項目</p>
                  {currentStep.checkItems.map((item, i) => {
                    const key = `${currentStep.order}-${i}`;
                    return (
                      <div key={key} className="flex items-start gap-3">
                        <Checkbox
                          id={key}
                          checked={!!checkedItems[key]}
                          onCheckedChange={(checked) =>
                            setCheckedItems((prev) => ({ ...prev, [key]: !!checked }))
                          }
                          className="mt-0.5"
                        />
                        <label
                          htmlFor={key}
                          className={`text-sm leading-relaxed cursor-pointer ${
                            checkedItems[key] ? "line-through text-muted-foreground" : "text-foreground"
                          }`}
                        >
                          {item}
                        </label>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 手書きメモ */}
        <Card className="rounded-2xl border-border">
          <CardContent className="p-5">
            <HandwritingCanvas
              onHasContent={setHasCanvasContent}
              onGetImageData={(fn) => setGetImageData(() => fn)}
              onRegisterClear={(fn) => setClearCanvas(() => fn)}
              height={180}
            />
          </CardContent>
        </Card>

        {/* ボタン2つ縦並び */}
        <div className="space-y-3 pb-6">
          {/* 「迷ったら押す」ボタン */}
          <Button
            size="lg"
            className="w-full h-16 text-lg font-bold rounded-2xl shadow-md transition-all duration-200 active:scale-[0.97]"
            style={{ backgroundColor: "var(--panic)", color: "var(--panic-foreground)" }}
            onClick={handlePanic}
            disabled={panicButtonMutation.isPending}
          >
            <AlertTriangle className="w-5 h-5 mr-2" />
            迷ったら押す
          </Button>

          {/* 完了ボタン */}
          <Button
            size="lg"
            className="w-full h-16 text-lg font-bold rounded-2xl shadow-md transition-all duration-200 active:scale-[0.97]"
            disabled={!canComplete || isCompletingStep}
            onClick={handleCompleteStep}
            style={{
              backgroundColor: canComplete ? "var(--success)" : undefined,
              color: canComplete ? "var(--success-foreground)" : undefined,
            }}
          >
            {isCompletingStep ? (
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
            ) : currentStepIndex < steps.length - 1 ? (
              <>
                完了して次へ
                <ChevronRight className="w-5 h-5 ml-1" />
              </>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5 mr-2" />
                作業を完了する
              </>
            )}
          </Button>

          {!canComplete && (
            <p className="text-center text-sm text-muted-foreground">
              ↑ 確認項目をすべてチェックしてください
            </p>
          )}
        </div>
        </div>{/* 右ペイン内部 */}
        </div>{/* 右ペイン */}
      </div>{/* メインコンテンツ */}
    </div>
  );
}
