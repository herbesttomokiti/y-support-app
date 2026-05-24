import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useLocation } from "wouter";
import { useState, useRef, useCallback } from "react";
import {
  Loader2,
  ArrowLeft,
  Sparkles,
  Plus,
  Trash2,
  Send,
  ChevronDown,
  ChevronUp,
  Paperclip,
  FileText,
  Image,
  X,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

interface Step {
  order: number;
  instruction: string;
  checkItems: string[];
}

interface UploadedFile {
  name: string;
  mimeType: string;
  fileUrl: string;
  fileType: "pdf" | "image" | "text" | "excel";
  textContent?: string; // テキスト・エクセルファイルの場合のみ
}

export default function AdminTaskCreate() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const [taskName, setTaskName] = useState("");
  const [clientName, setClientName] = useState("");
  const [description, setDescription] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState(30);
  const [steps, setSteps] = useState<Step[]>([]);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: users } = trpc.users.list.useQuery(undefined, { enabled: user?.role === "admin" });
  const [assignedTo, setAssignedTo] = useState<number | null>(null);

  const decomposeTask = trpc.llm.decomposeTask.useMutation();
  const uploadFile = trpc.llm.uploadInstructionFile.useMutation();
  const createTask = trpc.tasks.create.useMutation();
  const createTemplate = trpc.templates.create.useMutation();
  const utils = trpc.useUtils();

  // ファイルを読み込んでアップロードする
  const processFile = useCallback(async (file: File) => {
    const MAX_SIZE = 20 * 1024 * 1024; // 20MB
    if (file.size > MAX_SIZE) {
      toast.error("ファイルサイズは20MB以下にしてください");
      return;
    }

    const mimeType = file.type;
    const isPdf = mimeType === "application/pdf";
    const isImage = mimeType.startsWith("image/");
    const isText = mimeType.startsWith("text/") || file.name.endsWith(".txt") || file.name.endsWith(".md");
    const EXCEL_MIMES = [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel.sheet.macroEnabled.12",
    ];
    const isExcel = EXCEL_MIMES.includes(mimeType) ||
      file.name.endsWith(".xls") || file.name.endsWith(".xlsx") || file.name.endsWith(".xlsm");

    if (!isPdf && !isImage && !isText && !isExcel) {
      toast.error("PDF・画像（PNG/JPG）・テキスト・エクセルファイルのみ対応しています");
      return;
    }

    const fileType: "pdf" | "image" | "text" | "excel" = isPdf ? "pdf" : isImage ? "image" : isExcel ? "excel" : "text";

    try {
      toast.loading("ファイルをアップロード中...", { id: "file-upload" });

      // テキストファイルはそのまま読み込む
      if (isText) {
        const text = await file.text();
        // テキストはS3に保存せず直接LLMに渡す
        setUploadedFile({
          name: file.name,
          mimeType,
          fileUrl: "",
          fileType: "text",
          textContent: text,
        });
        // テキスト内容をdescriptionに反映（編集可能）
        if (!description.trim()) {
          setDescription(text.slice(0, 500));
        }
        toast.success("テキストファイルを読み込みました", { id: "file-upload" });
        return;
      }

      // PDF・画像・エクセルはbase64でサーバーに送る
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const result = await uploadFile.mutateAsync({
        base64,
        filename: file.name,
        mimeType,
      });

      if (isExcel) {
        // Excelはテキスト抽出 + S3に元ファイル保存
        setUploadedFile({
          name: file.name,
          mimeType,
          fileUrl: result.url || "",
          fileType: "excel",
          textContent: result.extractedText,
        });
        toast.success("エクセルファイルを読み込みました", { id: "file-upload" });
      } else {
        setUploadedFile({
          name: file.name,
          mimeType,
          fileUrl: result.url,
          fileType,
        });
        toast.success("ファイルをアップロードしました", { id: "file-upload" });
      }
    } catch {
      toast.error("アップロードに失敗しました", { id: "file-upload" });
    }
  }, [description, uploadFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    // 同じファイルを再選択できるようにリセット
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const removeFile = () => {
    setUploadedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDecompose = async () => {
    if (!description.trim() && !uploadedFile) {
      toast.error("作業内容を入力するか、指示書ファイルをアップロードしてください");
      return;
    }
    try {
      const result = await decomposeTask.mutateAsync({
        description,
        clientName: clientName || undefined,
        estimatedMinutes,
        fileUrl: (uploadedFile?.fileType === "pdf" || uploadedFile?.fileType === "image") ? uploadedFile?.fileUrl : undefined,
        fileType: uploadedFile?.fileType,
        fileText: (uploadedFile?.fileType === "text" || uploadedFile?.fileType === "excel") ? uploadedFile.textContent : undefined,
        origin: window.location.origin,
      });
      setSteps(result.steps);
      if (!taskName) setTaskName(description.slice(0, 40) || uploadedFile?.name.replace(/\.[^.]+$/, "") || "");
      toast.success(`${result.steps.length}ステップに分解しました`);
    } catch {
      toast.error("分解に失敗しました。もう一度お試しください");
    }
  };

  const handleSend = async () => {
    if (!taskName.trim() || steps.length === 0) {
      toast.error("作業名とステップが必要です");
      return;
    }
    if (!assignedTo) {
      toast.error("担当者を選択してください");
      return;
    }
    try {
      // scheduledDate: JST基準の今日の0時（UTC ms）
      // ブラウザはJST環境なので、ローカルの今日開始をそのまま使用
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      await createTask.mutateAsync({
        assignedTo,
        name: taskName,
        clientName: clientName || undefined,
        description,
        estimatedMinutes,
        steps,
        scheduledDate: todayStart.getTime(),
        // 指示書ファイル（PDF・画像・Excel変換後のPDFの場合にURLがある）
        instructionFileUrl: uploadedFile?.fileUrl || undefined,
        instructionFileKey: uploadedFile?.fileUrl ? uploadedFile.fileUrl.replace("/manus-storage/", "") : undefined,
        instructionFileName: uploadedFile?.name || undefined,
        instructionFileType: uploadedFile?.fileType || undefined,
      });
      utils.tasks.allTasks.invalidate();
      toast.success("作業カードを送信しました！");
      navigate("/admin");
    } catch {
      toast.error("送信に失敗しました");
    }
  };

  const handleSaveTemplate = async () => {
    if (!taskName.trim() || steps.length === 0) {
      toast.error("作業名とステップが必要です");
      return;
    }
    try {
      await createTemplate.mutateAsync({
        name: taskName,
        clientName: clientName || undefined,
        description,
        estimatedMinutes,
        steps,
      });
      utils.templates.list.invalidate();
      toast.success("テンプレートに保存しました");
    } catch {
      toast.error("保存に失敗しました");
    }
  };

  const updateStep = (index: number, field: keyof Step, value: string | string[]) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    );
  };

  const addStep = () => {
    const newOrder = steps.length + 1;
    setSteps((prev) => [...prev, { order: newOrder, instruction: "", checkItems: [] }]);
    setExpandedStep(steps.length);
  };

  const removeStep = (index: number) => {
    setSteps((prev) =>
      prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i + 1 }))
    );
  };

  const addCheckItem = (stepIndex: number) => {
    setSteps((prev) =>
      prev.map((s, i) =>
        i === stepIndex ? { ...s, checkItems: [...s.checkItems, ""] } : s
      )
    );
  };

  const updateCheckItem = (stepIndex: number, itemIndex: number, value: string) => {
    setSteps((prev) =>
      prev.map((s, i) =>
        i === stepIndex
          ? { ...s, checkItems: s.checkItems.map((c, j) => (j === itemIndex ? value : c)) }
          : s
      )
    );
  };

  const removeCheckItem = (stepIndex: number, itemIndex: number) => {
    setSteps((prev) =>
      prev.map((s, i) =>
        i === stepIndex
          ? { ...s, checkItems: s.checkItems.filter((_, j) => j !== itemIndex) }
          : s
      )
    );
  };

  const moveStepUp = (index: number) => {
    if (index === 0) return;
    setSteps((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next.map((s, i) => ({ ...s, order: i + 1 }));
    });
  };

  const moveStepDown = (index: number) => {
    setSteps((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next.map((s, i) => ({ ...s, order: i + 1 }));
    });
  };

  const getFileIcon = (fileType: "pdf" | "image" | "text" | "excel") => {
    if (fileType === "pdf") return <FileText className="w-4 h-4 text-red-500" />;
    if (fileType === "image") return <Image className="w-4 h-4 text-blue-500" />;
    if (fileType === "excel") return <FileText className="w-4 h-4 text-emerald-600" />;
    return <FileText className="w-4 h-4 text-green-600" />;
  };

  if (!user || user.role !== "admin") {
    return <div className="min-h-screen flex items-center justify-center"><p>管理者権限が必要です</p></div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-4">
        <div className="flex items-center gap-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-lg font-bold">作業カードを作成</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* 基本情報 */}
        <Card className="rounded-2xl border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">基本情報</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="taskName">作業名</Label>
              <Input
                id="taskName"
                placeholder="例：駐車場看板の修正"
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                className="rounded-xl"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="clientName">クライアント名</Label>
                <Input
                  id="clientName"
                  placeholder="例：システムバンク"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="estimatedMinutes">目安時間（分）</Label>
                <Input
                  id="estimatedMinutes"
                  type="number"
                  min={5}
                  max={480}
                  value={estimatedMinutes}
                  onChange={(e) => setEstimatedMinutes(parseInt(e.target.value) || 30)}
                  className="rounded-xl"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assignedTo">担当者</Label>
              <select
                id="assignedTo"
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                value={assignedTo ?? ""}
                onChange={(e) => setAssignedTo(parseInt(e.target.value) || null)}
              >
                <option value="">選択してください</option>
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

        {/* AI自動分解 */}
        <Card className="rounded-2xl border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              AIで自動分解
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">

            {/* ファイルアップロードエリア */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5" />
                指示書ファイル（PDF・画像・テキスト）
                <span className="text-xs text-muted-foreground font-normal ml-1">任意・最大20MB</span>
              </Label>

              {uploadedFile ? (
                /* アップロード済み表示 */
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-primary/40 bg-primary/5">
                  {getFileIcon(uploadedFile.fileType)}
                  <span className="text-sm font-medium flex-1 truncate">{uploadedFile.name}</span>
                  <span className="text-xs text-muted-foreground px-2 py-0.5 bg-background rounded-full border">
                    {uploadedFile.fileType === "pdf" ? "PDF" : uploadedFile.fileType === "image" ? "画像" : "テキスト"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive flex-shrink-0"
                    onClick={removeFile}
                    title="ファイルを削除"
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ) : (
                /* ドラッグ&ドロップエリア */
                <div
                  className={`relative rounded-xl border-2 border-dashed transition-all duration-200 ${
                    isDragging
                      ? "border-primary bg-primary/10 scale-[1.01]"
                      : "border-border hover:border-primary/50 hover:bg-primary/3"
                  }`}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.xls,.xlsx,.xlsm"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    onChange={handleFileChange}
                  />
                  <div className="flex flex-col items-center justify-center gap-2 py-6 pointer-events-none">
                    {uploadFile.isPending ? (
                      <Loader2 className="w-6 h-6 text-primary animate-spin" />
                    ) : (
                      <Upload className="w-6 h-6 text-muted-foreground" />
                    )}
                    <div className="text-center">
                      <p className="text-sm font-medium text-foreground">
                        {uploadFile.isPending ? "アップロード中..." : "ファイルをドラッグ＆ドロップ"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        または<span className="text-primary font-medium">クリックして選択</span>
                        　PDF / Excel / PNG / JPG / TXT
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 作業内容テキスト */}
            <div className="space-y-1.5">
              <Label htmlFor="description">
                作業内容
                {uploadedFile && (
                  <span className="text-xs text-muted-foreground font-normal ml-2">
                    （ファイルと合わせてAIに渡されます）
                  </span>
                )}
              </Label>
              <Textarea
                id="description"
                placeholder={
                  uploadedFile
                    ? "補足があれば入力してください（例：水色指定あり、PDF提出）"
                    : "例：駐車場A3パウチチラシの修正。水色指定あり。PDF提出。料金情報の更新と地図の差し替え。"
                }
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="rounded-xl min-h-[80px] resize-none"
              />
            </div>

            <Button
              className="w-full rounded-xl font-medium"
              onClick={handleDecompose}
              disabled={decomposeTask.isPending || (!description.trim() && !uploadedFile)}
            >
              {decomposeTask.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" />分解中...</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" />AIでステップに分解する</>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* ステップ編集 */}
        {steps.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                ステップ（{steps.length}件）
              </h2>
              <Button variant="ghost" size="sm" onClick={addStep} className="h-8 text-xs">
                <Plus className="w-3.5 h-3.5 mr-1" />追加
              </Button>
            </div>

            {steps.map((step, index) => (
              <Card key={index} className="rounded-xl border-border">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-xs font-bold text-primary">{step.order}</span>
                    </div>
                    <div className="flex-1 space-y-2">
                      <Input
                        value={step.instruction}
                        onChange={(e) => updateStep(index, "instruction", e.target.value)}
                        placeholder="操作指示を入力"
                        className="rounded-lg text-sm"
                      />
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground"
                        onClick={() => moveStepUp(index)}
                        disabled={index === 0}
                        title="上に移動"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground"
                        onClick={() => moveStepDown(index)}
                        disabled={index === steps.length - 1}
                        title="下に移動"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => removeStep(index)}
                        title="削除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  {expandedStep === index && (
                    <div className="pl-10 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">確認項目</p>
                      {step.checkItems.map((item, itemIndex) => (
                        <div key={itemIndex} className="flex gap-2">
                          <Input
                            value={item}
                            onChange={(e) => updateCheckItem(index, itemIndex, e.target.value)}
                            placeholder="確認項目"
                            className="rounded-lg text-sm h-8"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 flex-shrink-0 text-muted-foreground"
                            onClick={() => removeCheckItem(index, itemIndex)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground"
                        onClick={() => addCheckItem(index)}
                      >
                        <Plus className="w-3 h-3 mr-1" />確認項目を追加
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* アクションボタン */}
        {steps.length > 0 && (
          <div className="space-y-3 pb-8">
            <Button
              size="lg"
              className="w-full h-14 rounded-2xl font-bold text-base"
              onClick={handleSend}
              disabled={createTask.isPending || !assignedTo}
            >
              {createTask.isPending ? (
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
              ) : (
                <Send className="w-5 h-5 mr-2" />
              )}
送信する
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="w-full h-12 rounded-2xl font-medium"
              onClick={handleSaveTemplate}
              disabled={createTemplate.isPending}
            >
              {createTemplate.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              テンプレートとして保存
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
