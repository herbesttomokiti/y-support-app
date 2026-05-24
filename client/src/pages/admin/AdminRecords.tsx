import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLocation } from "wouter";
import { ArrowLeft, Download, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { toast } from "sonner";

export default function AdminRecords() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const { data: exportData, isLoading } = trpc.sheets.getExportData.useQuery(
    { limit: 50 },
    { enabled: user?.role === "admin" }
  );

  const { data: csvData, refetch: fetchCsv } = trpc.sheets.exportCsv.useQuery(
    {},
    { enabled: false }
  );

  const handleDownloadCsv = async () => {
    try {
      const result = await fetchCsv();
      if (!result.data) return;
      const { csv, filename } = result.data;
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("CSVをダウンロードしました");
    } catch {
      toast.error("ダウンロードに失敗しました");
    }
  };

  if (!user || user.role !== "admin") {
    return <div className="min-h-screen flex items-center justify-center"><p>管理者権限が必要です</p></div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-4">
        <div className="flex items-center justify-between max-w-3xl mx-auto">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-lg font-bold">作業記録</h1>
          </div>
          <Button
            size="sm"
            className="rounded-xl"
            onClick={handleDownloadCsv}
          >
            <Download className="w-4 h-4 mr-1" />
            CSVダウンロード
          </Button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <Card className="rounded-2xl border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <p className="text-sm text-foreground">
              CSVダウンロードで<strong>Googleスプレッドシート</strong>にインポートできます。
              日付・作業名・実績時間・手書きメモ・「迷ったら押す」回数などが含まれます。
            </p>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-2xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : exportData && exportData.length > 0 ? (
          exportData.map((record) => {
            const startDate = new Date(record.startedAt);
            const dateStr = `${startDate.getMonth() + 1}/${startDate.getDate()}`;
            const dayNames = ["日", "月", "火", "水", "木", "金", "土"];
            const dayStr = dayNames[startDate.getDay()] ?? "";

            return (
              <Card key={record.id} className="rounded-2xl border-border">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                        <span className="font-medium">{dateStr}（{dayStr}）</span>
                        {record.task?.clientName && <span>{record.task.clientName}</span>}
                      </div>
                      <h3 className="font-bold leading-tight">{record.task?.name ?? "不明"}</h3>
                    </div>
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                  </div>

                  <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      目安 {record.task?.estimatedMinutes}分 / 実績 {record.actualMinutes ?? "—"}分
                    </span>
                    {record.panicButtonCount > 0 && (
                      <span className="flex items-center gap-1 text-amber-600">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        迷い {record.panicButtonCount}回
                      </span>
                    )}
                  </div>

                  {record.completions && record.completions.length > 0 && (
                    <div className="border-t pt-3 space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">手書きメモ</p>
                      {record.completions.map((c) => (
                        <div key={c.id} className="flex items-start gap-2">
                          <span className="text-xs text-muted-foreground w-12 flex-shrink-0">Step {c.stepOrder}</span>
                          {c.memoImageUrl ? (
                            <img
                              src={c.memoImageUrl}
                              alt={`Step ${c.stepOrder} メモ`}
                              className="rounded border border-border max-h-16 object-contain bg-white"
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">（メモなし）</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-muted-foreground">完了した作業記録がまだありません</p>
          </div>
        )}
      </div>
    </div>
  );
}
