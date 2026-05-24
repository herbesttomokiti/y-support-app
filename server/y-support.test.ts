import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAdminContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "admin-user",
    email: "admin@example.com",
    name: "山岸（管理者）",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function createUserContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 2,
    openId: "y-user",
    email: "y@example.com",
    name: "山本",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// DB呼び出しをモック
vi.mock("./db", () => ({
  getTasksByUser: vi.fn().mockResolvedValue([
    {
      id: 1,
      name: "駐車場看板修正",
      clientName: "システムバンク",
      status: "pending",
      estimatedMinutes: 30,
      steps: [
        { order: 1, instruction: "Illustratorを開く", checkItems: ["ファイルが開いているか確認"] },
        { order: 2, instruction: "水色を指定色に変更する", checkItems: ["色が正しいか確認"] },
      ],
      assignedTo: 2,
      createdBy: 1,
      description: "水色指定あり",
      templateId: null,
      scheduledDate: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]),
  getAllTasksNoFilter: vi.fn().mockResolvedValue([
    {
      id: 1,
      name: "駐車場看板修正",
      clientName: "システムバンク",
      status: "pending",
      estimatedMinutes: 30,
      steps: [],
      assignedTo: 2,
      createdBy: 1,
      description: "",
      templateId: null,
      scheduledDate: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]),
  getAllTasks: vi.fn().mockResolvedValue([
    {
      id: 1,
      name: "駐車場看板修正",
      clientName: "システムバンク",
      status: "pending",
      estimatedMinutes: 30,
      steps: [
        { order: 1, instruction: "Illustratorを開く", checkItems: ["ファイルが開いているか確認"] },
        { order: 2, instruction: "水色を指定色に変更する", checkItems: ["色が正しいか確認"] },
      ],
      assignedTo: 2,
      createdBy: 1,
      description: "水色指定あり",
      templateId: null,
      scheduledDate: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]),
  getTaskById: vi.fn().mockResolvedValue({
    id: 1,
    name: "駐車場看板修正",
    clientName: "システムバンク",
    status: "pending",
    estimatedMinutes: 30,
    steps: [
      { order: 1, instruction: "Illustratorを開く", checkItems: [] },
    ],
    assignedTo: 2,
    createdBy: 1,
    description: "",
    templateId: null,
    scheduledDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  createTask: vi.fn().mockResolvedValue({ id: 2 }),
  updateTaskStatus: vi.fn().mockResolvedValue(undefined),
  getTemplates: vi.fn().mockResolvedValue([]),
  createTemplate: vi.fn().mockResolvedValue({ id: 1 }),
  updateTemplate: vi.fn().mockResolvedValue(undefined),
  deleteTemplate: vi.fn().mockResolvedValue(undefined),
  getTemplateById: vi.fn().mockResolvedValue(null),
  createSession: vi.fn().mockResolvedValue({ id: 10, taskId: 1, userId: 2, panicButtonCount: 0, currentStepOrder: 0, startedAt: new Date(), completedAt: null, actualMinutes: null, reportText: null, sheetExported: false, createdAt: new Date(), updatedAt: new Date() }),
  getActiveSession: vi.fn().mockResolvedValue(null),
  updateSession: vi.fn().mockResolvedValue(undefined),
  incrementPanicButton: vi.fn().mockResolvedValue(undefined),
  getSessionById: vi.fn().mockResolvedValue(null),
  getAllActiveSessions: vi.fn().mockResolvedValue([]),
  createStepCompletion: vi.fn().mockResolvedValue({ id: 1 }),
  getStepCompletionsBySession: vi.fn().mockResolvedValue([]),
  getPreviousSessionCompletions: vi.fn().mockResolvedValue([]),
  getAllUsers: vi.fn().mockResolvedValue([]),
  upsertUser: vi.fn().mockResolvedValue(undefined),
  getUserByOpenId: vi.fn().mockResolvedValue(null),
  getDb: vi.fn().mockResolvedValue(null),
}));

describe("作業アプリ - 権限チェック", () => {
  it("ノーログインで作業一覧を取得できる", async () => {
    // publicProcedureなので認証不要
    const ctx = { req: {} as TrpcContext["req"], res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"] };
    const caller = appRouter.createCaller(ctx);
    const tasks = await caller.tasks.myTasks();
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0]?.name).toBe("駐車場看板修正");
  });

  it("一般ユーザーは管理者専用の全タスク一覧にアクセスできない", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.tasks.allTasks()).rejects.toThrow();
  });

  it("管理者は全タスク一覧を取得できる", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const tasks = await caller.tasks.allTasks();
    expect(Array.isArray(tasks)).toBe(true);
  });

  it("一般ユーザーはテンプレート一覧にアクセスできない", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.templates.list()).rejects.toThrow();
  });

  it("管理者はテンプレートを作成できる", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.templates.create({
      name: "PDF書き出しテンプレ",
      description: "IllustratorからPDF書き出し",
      estimatedMinutes: 15,
      steps: [
        { order: 1, instruction: "ファイルメニュー → 書き出し → PDF", checkItems: ["保存先を確認"] },
      ],
    });
    expect(result).toBeDefined();
  });
});

describe("作業アプリ - セッション管理", () => {
  it("作業セッションを開始できる", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);
    const session = await caller.sessions.start({ taskId: 1 });
    expect(session).toBeDefined();
    expect(session?.taskId).toBe(1);
  });

  it("「迷ったら押す」ボタンの使用を記録できる", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.sessions.panicButton({ sessionId: 10 });
    expect(result.success).toBe(true);
  });

  it("進捗を更新できる", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.sessions.updateProgress({ sessionId: 10, currentStepOrder: 1 });
    expect(result.success).toBe(true);
  });
});
