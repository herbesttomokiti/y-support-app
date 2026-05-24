import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLocation } from "wouter";
import { Loader2, ArrowLeft, Plus, Trash2, Send, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface Step {
  order: number;
  instruction: string;
  checkItems: string[];
}

export default function AdminTemplates() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [sendingId, setSendingId] = useState<number | null>(null);

  const { data: templates, isLoading } = trpc.templates.list.useQuery(undefined, {
    enabled: user?.role === "admin",
  });
  const { data: users } = trpc.users.list.useQuery(undefined, { enabled: user?.role === "admin" });
  const deleteTemplate = trpc.templates.delete.useMutation();
  const createTask = trpc.tasks.create.useMutation();
  const utils = trpc.useUtils();

  const [assignedTo, setAssignedTo] = useState<number | null>(null);

  const handleDelete = async (id: number) => {
    if (!confirm("このテンプレートを削除しますか？")) return;
    try {
      await deleteTemplate.mutateAsync({ id });
      utils.templates.list.invalidate();
      toast.success("削除しました");
    } catch {
      toast.error("削除に失敗しました");
    }
  };

  type TemplateItem = NonNullable<typeof templates>[number];
  const handleSendFromTemplate = async (template: TemplateItem) => {
    if (!assignedTo) {
      toast.error("担当者を選択してください");
      return;
    }
    setSendingId(template.id);
    try {
      await createTask.mutateAsync({
        assignedTo,
        name: template.name,
        clientName: template.clientName ?? undefined,
        description: template.description,
        estimatedMinutes: template.estimatedMinutes ?? 30,
        steps: template.steps as Step[],
        templateId: template.id,
      });
      utils.tasks.allTasks.invalidate();
      toast.success(`「${template.name}」を送信しました`);
    } catch {
      toast.error("送信に失敗しました");
    } finally {
      setSendingId(null);
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
            <h1 className="text-lg font-bold">テンプレート管理</h1>
          </div>
          <Button
            size="sm"
            className="rounded-xl"
            onClick={() => navigate("/admin/tasks/create")}
          >
            <Plus className="w-4 h-4 mr-1" />新規作成
          </Button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {/* 担当者選択（送信用） */}
        <Card className="rounded-2xl border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-foreground whitespace-nowrap">送信先：</label>
              <select
                className="flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm"
                value={assignedTo ?? ""}
                onChange={(e) => setAssignedTo(parseInt(e.target.value) || null)}
              >
                <option value="">担当者を選択</option>
                {users?.filter((u) => ["高山", "大久保", "山岸"].includes(u.name ?? "")).map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
                {users?.filter((u) => !["高山", "大久保", "山岸"].includes(u.name ?? "")).map((u) => (
                  <option key={u.id} value={u.id}>{u.name ?? u.email ?? `User ${u.id}`}</option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : templates && templates.length > 0 ? (
          templates.map((template) => {
            const steps = (template.steps as Step[]) ?? [];
            const isExpanded = expandedId === template.id;
            return (
              <Card key={template.id} className="rounded-2xl border-border">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold leading-tight">{template.name}</h3>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        {template.clientName && <span>{template.clientName}</span>}
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />{template.estimatedMinutes}分
                        </span>
                        <span>{steps.length}ステップ</span>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setExpandedId(isExpanded ? null : template.id)}
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(template.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="space-y-2 border-t pt-3">
                      {steps.map((step) => (
                        <div key={step.order} className="flex items-start gap-2 text-sm">
                          <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center flex-shrink-0 text-xs font-bold text-muted-foreground mt-0.5">
                            {step.order}
                          </span>
                          <p className="text-foreground leading-relaxed">{step.instruction}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  <Button
                    size="sm"
                    className="w-full rounded-xl font-medium"
                    onClick={() => handleSendFromTemplate(template)}
                    disabled={sendingId === template.id || !assignedTo}
                  >
                    {sendingId === template.id ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Send className="w-4 h-4 mr-2" />
                    )}
                    このテンプレートで送信
                  </Button>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
            <p className="text-muted-foreground">テンプレートがまだありません</p>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => navigate("/admin/tasks/create")}
            >
              <Plus className="w-4 h-4 mr-2" />
              作業カードを作成してテンプレートに保存
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
