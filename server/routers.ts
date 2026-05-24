import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { storagePut } from "./storage";
import * as db from "./db";
import { sheetsRouter } from "./routers/sheets";
import { sdk } from "./_core/sdk";
import bcrypt from "bcryptjs";

// ── Step type ──────────────────────────────────────────────────────────────
const stepSchema = z.object({
  order: z.number(),
  instruction: z.string(),
  checkItems: z.array(z.string()).default([]),
});

// ── Auth ───────────────────────────────────────────────────────────────────
const authRouter = router({
  me: publicProcedure.query((opts) => opts.ctx.user),

  // メール＋パスワードログイン
  login: publicProcedure
    .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const user = await db.getUserByEmail(input.email);
      if (!user || !user.passwordHash) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "メールまたはパスワードが正しくありません" });
      }
      const valid = await bcrypt.compare(input.password, user.passwordHash);
      if (!valid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "メールまたはパスワードが正しくありません" });
      }
      // JWTSessionを発行
      const token = await sdk.createSessionToken(user.openId, {
        expiresInMs: ONE_YEAR_MS,
        name: user.name ?? "",
      });
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      return { success: true, user };
    }),

  // 担当者選択：ログイン後に選択したユーザーIDでセッションを再発行
  switchUser: protectedProcedure
    .input(z.object({ targetUserId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const target = await db.getUserById(input.targetUserId);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "ユーザーが見つかりません" });
      }
      // 新しいセッショントークンを発行
      const token = await sdk.createSessionToken(target.openId, {
        expiresInMs: ONE_YEAR_MS,
        name: target.name ?? "",
      });
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      return { success: true, user: target };
    }),

  // 全ユーザー一覧（担当者選択画面用）
  listUsers: protectedProcedure.query(async () => {
    const all = await db.getAllUsers();
    return all.map((u) => ({ id: u.id, name: u.name, role: u.role }));
  }),

  logout: publicProcedure.mutation(({ ctx }) => {
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    return { success: true } as const;
  }),
});

// ── Tasks ──────────────────────────────────────────────────────────────────
const tasksRouter = router({
  // 作業者：今日の作業一覧（ノーログインで閲覧可能）
  myTasks: publicProcedure.query(async () => {
    return db.getAllTasks();
  }),

  // 管理者：全タスク一覧（日付フィルターなし、常時全件表示）
  allTasks: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    return db.getAllTasksNoFilter();
  }),

  // タスク詳細（ノーログインで閲覧可能）
  getById: publicProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const task = await db.getTaskById(input.id);
    if (!task) throw new TRPCError({ code: "NOT_FOUND" });
    return task;
  }),

  // 管理者：タスク作成（担当者に送信）
  create: protectedProcedure
    .input(
      z.object({
        assignedTo: z.number(),
        name: z.string(),
        clientName: z.string().optional(),
        description: z.string().optional(),
        estimatedMinutes: z.number().default(30),
        steps: z.array(stepSchema),
        templateId: z.number().optional(),
        scheduledDate: z.number().optional(), // UTC ms
        instructionFileUrl: z.string().optional(),
        instructionFileKey: z.string().optional(),
        instructionFileName: z.string().optional(),
        instructionFileType: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const task = await db.createTask({
        ...input,
        createdBy: ctx.user.id,
        scheduledDate: input.scheduledDate ? new Date(input.scheduledDate) : undefined,
      });
      return task;
    }),

  // 管理者：タスク削除
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const dbInstance = await db.getDb();
      if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { tasks } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await dbInstance.delete(tasks).where(eq(tasks.id, input.id));
      return { success: true };
    }),
});

// ── Templates ──────────────────────────────────────────────────────────────
const templatesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    return db.getTemplates();
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        clientName: z.string().optional(),
        description: z.string(),
        estimatedMinutes: z.number().default(30),
        steps: z.array(stepSchema),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return db.createTemplate({ ...input, createdBy: ctx.user.id });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().optional(),
        clientName: z.string().optional(),
        description: z.string().optional(),
        estimatedMinutes: z.number().optional(),
        steps: z.array(stepSchema).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { id, ...data } = input;
      await db.updateTemplate(id, data);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      await db.deleteTemplate(input.id);
      return { success: true };
    }),
});

// ── LLM Step Decomposition ─────────────────────────────────────────────────
const llmRouter = router({
  // 指示書ファイルをS3にアップロードしてURLを返す
  uploadInstructionFile: protectedProcedure
    .input(
      z.object({
        base64: z.string(),         // data:mime/type;base64,... 形式
        filename: z.string(),
        mimeType: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      console.log("[upload] start", input.filename, input.mimeType, input.base64.length);
      try {
      const EXCEL_MIMES = [
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel.sheet.macroEnabled.12",
      ];
      const isExcel = EXCEL_MIMES.includes(input.mimeType) ||
        input.filename.endsWith(".xls") || input.filename.endsWith(".xlsx") || input.filename.endsWith(".xlsm");

      if (input.mimeType !== "application/pdf" &&
          !input.mimeType.startsWith("image/") &&
          !input.mimeType.startsWith("text/") &&
          !isExcel) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "PDF・画像・テキスト・エクセルファイルのみ対応しています" });
      }

      const base64Data = input.base64.replace(/^data:[^;]+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");

      // Excelはテキスト抽出 + S3に元ファイルを保存（Google Docs Viewerでプレビュー）
      if (isExcel) {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(buffer, { type: "buffer" });
        const textParts: string[] = [];
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
          if (csv.trim()) {
            textParts.push(`[シート: ${sheetName}]\n${csv}`);
          }
        }
        const extractedText = textParts.join("\n\n").slice(0, 8000); // トークン制限対策

        // 元ExcelファイルをS3に保存
        const key = `instructions/${Date.now()}-${input.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const result = await storagePut(key, buffer, input.mimeType);
        return { key: result.key, url: result.url, mimeType: input.mimeType, extractedText };
      }

      const key = `instructions/${Date.now()}-${input.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const result = await storagePut(key, buffer, input.mimeType);
      console.log("[upload] success", result.url);
      return { key: result.key, url: result.url, mimeType: input.mimeType, extractedText: undefined };
      } catch (err) {
        console.error("[upload] ERROR:", err);
        throw err;
      }
    }),

  decomposeTask: protectedProcedure
    .input(
      z.object({
        description: z.string(),
        clientName: z.string().optional(),
        estimatedMinutes: z.number().optional(),
        // ファイルアップロード後に渡す情報
        fileUrl: z.string().optional(),    // /manus-storage/... 形式のURL
        fileType: z.enum(["pdf", "image", "text", "excel"]).optional(),
        fileText: z.string().optional(),   // テキスト・エクセルファイルの場合は内容をそのまま渡す
        origin: z.string().optional(),     // フロントエンドからwindow.location.originを渡す
      })
    )
    .mutation(async ({ input }) => {
      const systemPrompt = `あなたはデザイン制作会社の業務アシスタントです。
発達特性（ワーキングメモリーが少ない）を持つデザイナーのために、作業指示を「何を修正・変更するか」のレベルで分解してください。

【分解のルール】
- 1ステップ = 「何をどう変えるか」を簡潔に記載する（例：「料金の数字を『1,500円』に変更」）
- ソフトの操作手順（クリック・ショートカットキー・ツール名など）は書かない
- 抽象的な表現（「いい感じに」「ちゃんと」）は使わない
- 変更内容・場所・具体的な数値・ファイル名を明記する
- 確認・報告のタイミングも必ずステップに含める
- 1作業あたり最大10ステップを目安にする
- 各ステップに確認項目（checkItems）を1〜2個付ける

【良い例】
- 「クライアント名を『システムバンク』に変更」
- 「料金表の数値を指示書の通りに修正」
- 「地図画像を指定の新しい画像に差し替え」

【悪い例（書かない）】
- 「テキストボックスを選択ツール（V）で選択します」
- 「ファイルメニューから『保存』をクリックします」

【対象業務】デザイン制作（Illustrator・Photoshop・InDesign・動画編集など）

必ずJSON形式で返してください。`;

      const baseText = `以下の作業を分解してください：
作業内容：${input.description || "（添付ファイルを参照）"}
${input.clientName ? `クライアント：${input.clientName}` : ""}
${input.estimatedMinutes ? `目安時間：${input.estimatedMinutes}分` : ""}
${input.fileText ? `\n【指示書の内容】\n${input.fileText}` : ""}`;

      // ファイルタイプに応じてLLMメッセージを構築
      let userMessage: import("./_core/llm").MessageContent | import("./_core/llm").MessageContent[];
      if ((input.fileType === "pdf" || input.fileType === "image") && input.fileUrl) {
        // PDFまたは画像はfile_url / image_urlとして渡す
        // フロントから渡されたoriginを優先、なければ環境変数から推測
        const appOrigin = input.origin ||
          (process.env.VITE_OAUTH_PORTAL_URL
            ? new URL(process.env.VITE_OAUTH_PORTAL_URL).origin
            : "");
        const absoluteUrl = input.fileUrl.startsWith("http")
          ? input.fileUrl
          : `${appOrigin}${input.fileUrl}`;
        if (input.fileType === "pdf") {
          userMessage = [
            { type: "text" as const, text: baseText },
            { type: "file_url" as const, file_url: { url: absoluteUrl, mime_type: "application/pdf" as const } },
          ];
        } else {
          userMessage = [
            { type: "text" as const, text: baseText },
            { type: "image_url" as const, image_url: { url: absoluteUrl, detail: "auto" as const } },
          ];
        }
      } else {
        // テキスト・エクセル抽出テキストまたはファイルなし（fileTextはbaseText内に包含済み）
        userMessage = baseText;
      }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "task_steps",
            strict: true,
            schema: {
              type: "object",
              properties: {
                steps: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      order: { type: "integer", description: "ステップ番号（1始まり）" },
                      instruction: { type: "string", description: "具体的な操作指示" },
                      checkItems: {
                        type: "array",
                        items: { type: "string" },
                        description: "確認項目リスト",
                      },
                    },
                    required: ["order", "instruction", "checkItems"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["steps"],
              additionalProperties: false,
            },
          },
        },
      });

      const rawContent = response.choices?.[0]?.message?.content;
      const content = typeof rawContent === "string" ? rawContent : null;
      if (!content) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM応答が空です" });

      try {
        const parsed = JSON.parse(content) as { steps: Array<{ order: number; instruction: string; checkItems: string[] }> };
        return parsed;
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM応答のパースに失敗しました" });
      }
    }),

  // 報告テンプレ生成
  generateReport: protectedProcedure
    .input(
      z.object({
        taskName: z.string(),
        clientName: z.string().optional(),
        steps: z.array(stepSchema),
        stepMemos: z.array(z.object({ stepOrder: z.number(), memoText: z.string().optional() })),
        actualMinutes: z.number().optional(),
        estimatedMinutes: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const memoSummary = input.stepMemos
        .filter((m) => m.memoText)
        .map((m) => {
          const step = input.steps.find((s) => s.order === m.stepOrder);
          return `Step${m.stepOrder}（${step?.instruction ?? ""}）: ${m.memoText}`;
        })
        .join("\n");

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `あなたはデザイン制作会社のスタッフの報告文を作成するアシスタントです。
簡潔で分かりやすい報告文を作成してください。`,
          },
          {
            role: "user",
            content: `以下の情報をもとに報告文を作成してください：
作業名：${input.taskName}
${input.clientName ? `クライアント：${input.clientName}` : ""}
目安時間：${input.estimatedMinutes ?? "未設定"}分
実績時間：${input.actualMinutes ?? "未計測"}分
各ステップのメモ：
${memoSummary || "（メモなし）"}

【報告文の形式】
・やったこと：（作業の概要）
・気づいたこと：（作業中に気になった点）
・不安な点：（確認が必要な点）`,
          },
        ],
      });

      const content = response.choices?.[0]?.message?.content;
      return typeof content === "string" ? content : "";
    }),
});

// ── Sessions ───────────────────────────────────────────────────────────────
const sessionsRouter = router({
  // 作業開始（ノーログインで利用可能）
  start: publicProcedure
    .input(z.object({ taskId: z.number() }))
    .mutation(async ({ input }) => {
      const task = await db.getTaskById(input.taskId);
      if (!task) throw new TRPCError({ code: "NOT_FOUND" });

      // 既存のアクティブセッションを確認（userId=0を作業者共通のIDとして使用）
      const existing = await db.getActiveSession(input.taskId, 0);
      if (existing && !existing.completedAt) return existing;

      await db.updateTaskStatus(input.taskId, "in_progress");
      const session = await db.createSession({
        taskId: input.taskId,
        userId: 0, // 作業者は共通のuserId=0を使用
      });
      return session;
    }),

  // 進捗更新（ノーログインで利用可能）
  updateProgress: publicProcedure
    .input(
      z.object({
        sessionId: z.number(),
        currentStepOrder: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      await db.updateSession(input.sessionId, { currentStepOrder: input.currentStepOrder });
      return { success: true };
    }),

  // 「迷ったら押す」ボタン使用（ノーログインで利用可能）
  panicButton: publicProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ input }) => {
      await db.incrementPanicButton(input.sessionId);
      return { success: true };
    }),

  // ステップ完了記録（手書きメモ画像含む）（ノーログインで利用可能）
  completeStep: publicProcedure
    .input(
      z.object({
        sessionId: z.number(),
        taskId: z.number(),
        stepOrder: z.number(),
        memoImageBase64: z.string().optional(), // base64エンコードされたCanvas画像
        memoText: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      let memoImageKey: string | undefined;
      let memoImageUrl: string | undefined;

      if (input.memoImageBase64) {
        // base64をBufferに変換してS3に保存
        const base64Data = input.memoImageBase64.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");
        const key = `memos/session-${input.sessionId}/step-${input.stepOrder}-${Date.now()}.png`;
        const result = await storagePut(key, buffer, "image/png");
        memoImageKey = result.key;
        memoImageUrl = result.url;
      }

      const completion = await db.createStepCompletion({
        sessionId: input.sessionId,
        taskId: input.taskId,
        stepOrder: input.stepOrder,
        memoImageKey,
        memoImageUrl,
        memoText: input.memoText,
      });

      return completion;
    }),

  // 作業完了（ノーログインで利用可能）
  complete: publicProcedure
    .input(
      z.object({
        sessionId: z.number(),
        taskId: z.number(),
        actualMinutes: z.number().optional(),
        reportText: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await db.updateSession(input.sessionId, {
        completedAt: new Date(),
        actualMinutes: input.actualMinutes,
        reportText: input.reportText,
      });
      await db.updateTaskStatus(input.taskId, "completed");
      return { success: true };
    }),

  // セッション詳細取得（ノーログインで利用可能）
  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const session = await db.getSessionById(input.id);
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      const completions = await db.getStepCompletionsBySession(input.id);
      return { session, completions };
    }),

  // 前回ログ取得（ノーログインで利用可能）
  previousLog: publicProcedure
    .input(z.object({ taskId: z.number() }))
    .query(async ({ input }) => {
      return db.getPreviousSessionCompletions(input.taskId, 0);
    }),

  // 管理者：全アクティブセッション（進捗確認）
  allActive: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    const sessions = await db.getAllActiveSessions();
    // タスク情報を付加
    const enriched = await Promise.all(
      sessions.map(async (s) => {
        const task = await db.getTaskById(s.taskId);
        return { ...s, task };
      })
    );
    return enriched;
  }),

  // 管理者：特定セッションの完了ステップ一覧
  completionsBySession: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return db.getStepCompletionsBySession(input.sessionId);
    }),
});

// ── Users ──────────────────────────────────────────────────────────────────
const usersRouter = router({
  // 管理者：ユーザー一覧（担当者を選択するため）
  list: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    return db.getAllUsers();
  }),
});

// ── App Router ─────────────────────────────────────────────────────────────
export const appRouter = router({
  system: systemRouter,
  auth: authRouter,
  tasks: tasksRouter,
  templates: templatesRouter,
  llm: llmRouter,
  sessions: sessionsRouter,
  users: usersRouter,
  sheets: sheetsRouter,
});

export type AppRouter = typeof appRouter;
