import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

interface Step {
  order: number;
  instruction: string;
  checkItems: string[];
}

/**
 * Googleスプレッドシートへのデータ書き出し
 * Google Sheets API v4 を使用（OAuth2サービスアカウント不要のAPIキー方式は書き込み不可のため、
 * プロトタイプではCSV形式でダウンロードできる形式を提供し、
 * 将来的にはGoogle OAuth連携で直接書き出しを実装する）
 */
export const sheetsRouter = router({
  // セッションデータをCSV形式でエクスポート
  exportCsv: protectedProcedure
    .input(
      z.object({
        sessionIds: z.array(z.number()).optional(),
        dateFrom: z.number().optional(), // UTC ms
        dateTo: z.number().optional(),   // UTC ms
      })
    )
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });

      const sessions = await db.getAllActiveSessions();
      const filteredSessions = sessions.filter((s) => {
        if (input.sessionIds && !input.sessionIds.includes(s.id)) return false;
        if (input.dateFrom && s.startedAt.getTime() < input.dateFrom) return false;
        if (input.dateTo && s.startedAt.getTime() > input.dateTo) return false;
        return true;
      });

      const rows: string[][] = [
        [
          "日付",
          "曜日",
          "クライアント",
          "作業名",
          "目安時間(分)",
          "実績時間(分)",
          "開始時刻",
          "完了時刻",
          "「迷ったら押す」回数",
          "報告テンプレ",
          "ステップ完了メモ",
        ],
      ];

      const dayNames = ["日", "月", "火", "水", "木", "金", "土"];

      for (const session of filteredSessions) {
        const task = await db.getTaskById(session.taskId);
        if (!task) continue;

        const completions = await db.getStepCompletionsBySession(session.id);
        const memoSummary = completions
          .map((c) => `Step${c.stepOrder}: ${c.memoText ?? "（手書き）"}`)
          .join(" | ");

        const startDate = new Date(session.startedAt);
        const dateStr = `${startDate.getFullYear()}/${startDate.getMonth() + 1}/${startDate.getDate()}`;
        const dayStr = dayNames[startDate.getDay()] ?? "";
        const startTimeStr = startDate.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
        const endTimeStr = session.completedAt
          ? new Date(session.completedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
          : "";

        rows.push([
          dateStr,
          dayStr,
          task.clientName ?? "",
          task.name,
          String(task.estimatedMinutes ?? ""),
          String(session.actualMinutes ?? ""),
          startTimeStr,
          endTimeStr,
          String(session.panicButtonCount),
          (session.reportText ?? "").replace(/\n/g, " "),
          memoSummary,
        ]);
      }

      // CSV文字列に変換
      const csvContent = rows
        .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
        .join("\n");

      // BOM付きUTF-8（Excelで開けるように）
      const bom = "\uFEFF";
      return { csv: bom + csvContent, filename: `作業記録_${new Date().toISOString().slice(0, 10)}.csv` };
    }),

  // 完了セッションの詳細データ取得（スプレッドシート表示用）
  getExportData: protectedProcedure
    .input(
      z.object({
        limit: z.number().default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });

      const allSessions = await db.getAllActiveSessions();
      const completedSessions = allSessions
        .filter((s) => s.completedAt)
        .slice(0, input.limit);

      const enriched = await Promise.all(
        completedSessions.map(async (session) => {
          const task = await db.getTaskById(session.taskId);
          const completions = await db.getStepCompletionsBySession(session.id);
          return {
            ...session,
            task,
            completions,
          };
        })
      );

      return enriched;
    }),
});
