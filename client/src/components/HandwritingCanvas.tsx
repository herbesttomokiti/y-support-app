import { useRef, useEffect, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eraser, Undo2, Trash2, Pen } from "lucide-react";

interface HandwritingCanvasProps {
  onHasContent: (hasContent: boolean) => void;
  onGetImageData: (fn: () => string | null) => void;
  onRegisterClear?: (fn: () => void) => void;
  height?: number;
}

type Tool = "pen" | "eraser";

// ベジェ曲線スムージング用に直近の点を保持する数
const SMOOTH_POINTS = 4;

// 筆圧から線幅を計算（Apple Pencil対応）
function pressureToWidth(pressure: number, base: number): number {
  // pressure=0.5がデフォルト（マウス・指）→ base幅
  // pressure=1.0（最大筆圧）→ base*1.8
  // pressure=0.1（最小筆圧）→ base*0.5
  const normalized = Math.max(0.1, Math.min(1.0, pressure));
  return base * (0.5 + normalized * 1.3);
}

export default function HandwritingCanvas({
  onHasContent,
  onGetImageData,
  onRegisterClear,
  height = 200,
}: HandwritingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const pointsRef = useRef<{ x: number; y: number; width: number }[]>([]);
  const rafRef = useRef<number | null>(null);
  const pendingPos = useRef<{ x: number; y: number; width: number } | null>(null);
  const [hasStroke, setHasStroke] = useState(false);
  const [tool, setTool] = useState<Tool>("pen");

  // Undo用のスナップショット履歴（Canvas全体のImageData）
  const historyRef = useRef<ImageData[]>([]);
  const MAX_HISTORY = 30;

  const PEN_COLOR = "#1e3a5f";
  const PEN_SIZE = 4;       // 少し太めにして視認性向上
  const ERASER_SIZE = 28;

  const getCanvas = () => canvasRef.current;
  const getCtx = () => canvasRef.current?.getContext("2d");

  // Canvas初期化（Retinaディスプレイ対応）
  useEffect(() => {
    const canvas = getCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = PEN_SIZE;
    // 初期状態をhistoryに積む
    historyRef.current = [ctx.getImageData(0, 0, canvas.width, canvas.height)];
  }, []);

  // 画像データ取得関数を親に渡す
  useEffect(() => {
    onGetImageData(() => {
      const canvas = getCanvas();
      if (!canvas || !hasStroke) return null;
      return canvas.toDataURL("image/png");
    });
  }, [hasStroke, onGetImageData]);

  // 描画前にスナップショットを保存
  const saveSnapshot = useCallback(() => {
    const canvas = getCanvas();
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    historyRef.current.push(snapshot);
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift();
    }
  }, []);

  const getPos = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = getCanvas();
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }, []);

  // ベジェ曲線でなめらかに描画する
  const drawSmoothLine = useCallback((ctx: CanvasRenderingContext2D) => {
    const pts = pointsRef.current as { x: number; y: number; width: number }[];
    if (pts.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);

    if (pts.length === 2) {
      ctx.lineTo(pts[1].x, pts[1].y);
    } else {
      // 二次ベジェ曲線：中点を制御点として使用
      for (let i = 1; i < pts.length - 1; i++) {
        const midX = (pts[i].x + pts[i + 1].x) / 2;
        const midY = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
      }
      // 最後の点まで直線
      const last = pts[pts.length - 1];
      ctx.lineTo(last.x, last.y);
    }
    ctx.stroke();
  }, []);

  const startDrawing = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const canvas = getCanvas();
      const ctx = getCtx();
      if (!ctx || !canvas) return;

      // ポインターキャプチャ：iPadでの追跡精度向上
      canvas.setPointerCapture(e.pointerId);

      // ストローク開始前にスナップショット保存（Undo用）
      saveSnapshot();
      isDrawing.current = true;
      const pos = getPos(e);
      const width = pressureToWidth(e.pressure || 0.5, PEN_SIZE);
      pointsRef.current = [{ ...pos, width }];

      // ペン設定
      if (tool === "pen") {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = PEN_COLOR;
        ctx.lineWidth = PEN_SIZE;
      } else {
        ctx.globalCompositeOperation = "destination-out";
        ctx.lineWidth = ERASER_SIZE;
      }
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    },
    [getPos, saveSnapshot, tool]
  );

  const draw = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawing.current) return;
      e.preventDefault();
      const ctx = getCtx();
      if (!ctx) return;
      const pos = getPos(e);

      if (tool === "pen") {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = PEN_COLOR;
        ctx.lineWidth = PEN_SIZE;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        // 直近SMOOTH_POINTS点を保持してベジェ補間（rAFで描画最適化）
        const width = pressureToWidth(e.pressure || 0.5, PEN_SIZE);
        pendingPos.current = { ...pos, width };
        if (rafRef.current === null) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            if (!pendingPos.current) return;
            const ctx2 = getCtx();
            if (!ctx2) return;
            ctx2.globalCompositeOperation = "source-over";
            ctx2.strokeStyle = PEN_COLOR;
            ctx2.lineCap = "round";
            ctx2.lineJoin = "round";
            pointsRef.current.push(pendingPos.current);
            if (pointsRef.current.length > SMOOTH_POINTS + 1) {
              pointsRef.current.shift();
            }
            // 可変線幅：最新点の幅を使用
            ctx2.lineWidth = pendingPos.current.width;
            drawSmoothLine(ctx2);
            pendingPos.current = null;
          });
        }
      } else {
        // 消しゴム：シンプルな直線で十分
        ctx.globalCompositeOperation = "destination-out";
        ctx.lineWidth = ERASER_SIZE;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const prev = pointsRef.current[pointsRef.current.length - 1];
        if (prev) {
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(pos.x, pos.y);
          ctx.stroke();
        }
        pointsRef.current = [{ ...pos, width: ERASER_SIZE }];
      }

      if (!hasStroke && tool === "pen") {
        setHasStroke(true);
        onHasContent(true);
      }
    },
    [getPos, hasStroke, onHasContent, tool, drawSmoothLine]
  );

  const stopDrawing = useCallback(() => {
    const ctx = getCtx();
    if (ctx) {
      ctx.globalCompositeOperation = "source-over";
    }
    isDrawing.current = false;
    pointsRef.current = [];
    pendingPos.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // 消しゴム使用後にキャンバスが空かチェック
    if (tool === "eraser") {
      const canvas = getCanvas();
      if (!canvas) return;
      const checkCtx = canvas.getContext("2d");
      if (!checkCtx) return;
      const imageData = checkCtx.getImageData(0, 0, canvas.width, canvas.height);
      const hasAnyPixel = imageData.data.some((v, i) => i % 4 === 3 && v > 0);
      if (!hasAnyPixel) {
        setHasStroke(false);
        onHasContent(false);
      }
    }
  }, [tool, onHasContent]);

  // Undo：1つ前のスナップショットに戻す
  const handleUndo = useCallback(() => {
    const canvas = getCanvas();
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    if (historyRef.current.length <= 1) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setHasStroke(false);
      onHasContent(false);
      return;
    }
    historyRef.current.pop();
    const prev = historyRef.current[historyRef.current.length - 1];
    if (prev) {
      ctx.putImageData(prev, 0, 0);
      const hasAnyPixel = prev.data.some((v, i) => i % 4 === 3 && v > 0);
      if (!hasAnyPixel) {
        setHasStroke(false);
        onHasContent(false);
      }
    }
  }, [onHasContent]);

  // 全消し
  const clearCanvas = useCallback(() => {
    const canvas = getCanvas();
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    historyRef.current = [ctx.getImageData(0, 0, canvas.width, canvas.height)];
    setHasStroke(false);
    onHasContent(false);
  }, [onHasContent]);

  // 親コンポーネントからclearCanvasを呼べるよう登録
  useEffect(() => {
    if (onRegisterClear) {
      onRegisterClear(clearCanvas);
    }
  }, [onRegisterClear, clearCanvas]);

  return (
    <div className="space-y-2">
      {/* ヘッダー */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-medium text-foreground">
          ✏️ このステップで気づいたことをメモ（任意）
        </p>

        {/* ツールバー */}
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant={tool === "pen" ? "default" : "outline"}
            size="sm"
            onClick={() => setTool("pen")}
            className="h-8 px-2.5"
            title="ペン"
          >
            <Pen className="w-3.5 h-3.5 mr-1" />
            ペン
          </Button>

          <Button
            type="button"
            variant={tool === "eraser" ? "default" : "outline"}
            size="sm"
            onClick={() => setTool("eraser")}
            className="h-8 px-2.5"
            title="消しゴム"
          >
            <Eraser className="w-3.5 h-3.5 mr-1" />
            消しゴム
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleUndo}
            className="h-8 px-2.5"
            title="元に戻す"
            disabled={historyRef.current.length <= 1 && !hasStroke}
          >
            <Undo2 className="w-3.5 h-3.5 mr-1" />
            戻す
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearCanvas}
            className="h-8 px-2.5 text-muted-foreground hover:text-destructive"
            title="全て消す"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" />
            全消し
          </Button>
        </div>
      </div>

      {/* キャンバスエリア */}
      <div
        className="relative rounded-xl border-2 overflow-hidden bg-white"
        style={{
          borderStyle: hasStroke ? "solid" : "dashed",
          borderColor: hasStroke ? "var(--primary)" : "var(--border)",
          transition: "border-color 0.2s, border-style 0.2s",
          cursor: tool === "eraser" ? "cell" : "crosshair",
        }}
      >
        {tool === "eraser" && (
          <div className="absolute top-2 left-2 z-10 bg-orange-100 text-orange-700 text-xs px-2 py-0.5 rounded-full font-medium pointer-events-none select-none">
            消しゴムモード
          </div>
        )}

        <canvas
          ref={canvasRef}
          className="w-full touch-none"
          style={{ height: `${height}px`, display: "block" }}
          onPointerDown={startDrawing}
          onPointerMove={draw}
          onPointerUp={stopDrawing}
          onPointerLeave={stopDrawing}
          onPointerCancel={stopDrawing}
        />

        {!hasStroke && tool === "pen" && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-muted-foreground text-sm select-none">
              Apple Pencilまたは指で書いてください
            </p>
          </div>
        )}
      </div>

      {hasStroke && (
        <p className="text-xs text-primary flex items-center gap-1">
          <span>✓</span> メモが記録されました
        </p>
      )}
    </div>
  );
}
