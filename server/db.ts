import { eq, desc, and, sql, inArray, or, gte, lt, getTableColumns, sum } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  tasks,
  taskTemplates,
  taskSessions,
  stepCompletions,
  InsertTask,
  InsertTaskTemplate,
  InsertTaskSession,
  InsertStepCompletion,
} from "../drizzle/schema";
let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ── Users ──────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;

  for (const field of textFields) {
    const value = user[field];
    if (value === undefined) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result[0];
}

export async function setPasswordHash(userId: number, hash: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(users).set({ passwordHash: hash, updatedAt: new Date() }).where(eq(users.id, userId));
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users);
}

// ── Task Templates ─────────────────────────────────────────────────────────

export async function createTemplate(data: InsertTaskTemplate) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(taskTemplates).values(data);
  return result[0];
}

export async function getTemplates(createdBy?: number) {
  const db = await getDb();
  if (!db) return [];
  if (createdBy !== undefined) {
    return db.select().from(taskTemplates).where(eq(taskTemplates.createdBy, createdBy)).orderBy(desc(taskTemplates.updatedAt));
  }
  return db.select().from(taskTemplates).orderBy(desc(taskTemplates.updatedAt));
}

export async function getTemplateById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(taskTemplates).where(eq(taskTemplates.id, id)).limit(1);
  return result[0];
}

export async function updateTemplate(id: number, data: Partial<InsertTaskTemplate>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(taskTemplates).set(data).where(eq(taskTemplates.id, id));
}

export async function deleteTemplate(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(taskTemplates).where(eq(taskTemplates.id, id));
}

// ── Tasks ──────────────────────────────────────────────────────────────────

export async function createTask(data: InsertTask) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(tasks).values(data);
  const result = await db.select().from(tasks).orderBy(desc(tasks.createdAt)).limit(1);
  return result[0];
}

export async function getTasksByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];

  // ログインユーザー自身のIDに加え、同じ名前のシードユーザーIDも含めて検索する
  // （管理者がシードユーザーIDでassignedToを設定した場合に対応）
  const loginUser = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const loginName = loginUser[0]?.name;

  let targetIds = [userId];
  if (loginName) {
    const sameNameUsers = await db.select({ id: users.id }).from(users).where(eq(users.name, loginName));
    const allIds = [userId, ...sameNameUsers.map((u) => u.id)];
    targetIds = allIds.filter((id, index) => allIds.indexOf(id) === index);
  }

  return db.select().from(tasks).where(inArray(tasks.assignedTo, targetIds)).orderBy(desc(tasks.createdAt));
}

export async function getTaskById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return result[0];
}

export async function updateTaskStatus(id: number, status: "pending" | "in_progress" | "completed") {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(tasks).set({ status }).where(eq(tasks.id, id));
}

export async function getAllTasks() {
  const db = await getDb();
  if (!db) return [];
  // JST（UTC+9）基準で「今日」の範囲を計算
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const nowUtc = Date.now();
  const nowJst = new Date(nowUtc + JST_OFFSET_MS);
  const jstYear = nowJst.getUTCFullYear();
  const jstMonth = nowJst.getUTCMonth();
  const jstDate = nowJst.getUTCDate();
  const todayStartUtc = new Date(Date.UTC(jstYear, jstMonth, jstDate, 0, 0, 0, 0) - JST_OFFSET_MS);
  const todayEndUtc = new Date(Date.UTC(jstYear, jstMonth, jstDate, 23, 59, 59, 999) - JST_OFFSET_MS);
  // usersテーブルをLEFT JOINして担当者名を取得
  const rows = await db
    .select({ ...getTableColumns(tasks), assignedUserName: users.name })
    .from(tasks)
    .leftJoin(users, eq(tasks.assignedTo, users.id))
    .where(
      sql`(
        (${tasks.scheduledDate} IS NOT NULL AND ${tasks.scheduledDate} >= ${todayStartUtc} AND ${tasks.scheduledDate} <= ${todayEndUtc})
        OR
        (${tasks.scheduledDate} IS NULL AND ${tasks.createdAt} >= ${todayStartUtc} AND ${tasks.createdAt} <= ${todayEndUtc})
      )`
    )
    .orderBy(desc(tasks.createdAt));
  return rows;
}

// 管理者用：日付フィルターなしで全タスクを返す（担当者名も含む）
export async function getAllTasksNoFilter() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      ...getTableColumns(tasks),
      assignedUserName: users.name,
      totalPanicCount: sql<number>`COALESCE(SUM(${taskSessions.panicButtonCount}), 0)`,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.assignedTo, users.id))
    .leftJoin(taskSessions, eq(taskSessions.taskId, tasks.id))
    .groupBy(tasks.id, users.name)
    .orderBy(desc(tasks.createdAt));
}

// ── Task Sessions ──────────────────────────────────────────────────────────

export async function createSession(data: InsertTaskSession) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(taskSessions).values(data);
  const result = await db.select().from(taskSessions).orderBy(desc(taskSessions.createdAt)).limit(1);
  return result[0];
}

export async function getActiveSession(taskId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(taskSessions)
    .where(and(eq(taskSessions.taskId, taskId), eq(taskSessions.userId, userId)))
    .orderBy(desc(taskSessions.createdAt))
    .limit(1);
  return result[0];
}

export async function updateSession(id: number, data: Partial<InsertTaskSession>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(taskSessions).set(data).where(eq(taskSessions.id, id));
}

export async function incrementPanicButton(sessionId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db
    .update(taskSessions)
    .set({ panicButtonCount: sql`${taskSessions.panicButtonCount} + 1` })
    .where(eq(taskSessions.id, sessionId));
}

export async function getSessionById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(taskSessions).where(eq(taskSessions.id, id)).limit(1);
  return result[0];
}

export async function getAllActiveSessions() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(taskSessions).where(eq(taskSessions.sheetExported, false)).orderBy(desc(taskSessions.createdAt));
}

// ── Step Completions ───────────────────────────────────────────────────────

export async function createStepCompletion(data: InsertStepCompletion) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(stepCompletions).values(data);
  const result = await db.select().from(stepCompletions).orderBy(desc(stepCompletions.createdAt)).limit(1);
  return result[0];
}

export async function getStepCompletionsBySession(sessionId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(stepCompletions)
    .where(eq(stepCompletions.sessionId, sessionId))
    .orderBy(stepCompletions.stepOrder);
}

export async function getPreviousSessionCompletions(taskId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  // 直近の完了セッションを取得
  const prevSessions = await db
    .select()
    .from(taskSessions)
    .where(and(eq(taskSessions.taskId, taskId), eq(taskSessions.userId, userId)))
    .orderBy(desc(taskSessions.completedAt))
    .limit(3);

  if (prevSessions.length === 0) return [];

  const latestSession = prevSessions[0];
  if (!latestSession) return [];
  return getStepCompletionsBySession(latestSession.id);
}

// ── Staff Seed ─────────────────────────────────────────────────────────────

/** サーバー起動時に固定スタッフ（高山・大久保・山岸）と管理者をusersテーブルにupsertし、パスワードを設定する */
export async function seedStaffUsers(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // bcryptjsを動的インポート（サーバー起動時のみ使用）
  const bcrypt = await import("bcryptjs");
  const SHARED_EMAIL = "info@herbest.biz";
  const SHARED_PASSWORD = "Tomo3310";
  const passwordHash = await bcrypt.hash(SHARED_PASSWORD, 10);

  // 管理者ユーザー（ハーベスト）のパスワードを設定
  // openIdがすでにDBにある場合はpasswordHashとemailのみ更新
  const adminList = await db.select().from(users).where(eq(users.role, "admin"));
  for (const admin of adminList) {
    try {
      await db
        .update(users)
        .set({ email: SHARED_EMAIL, passwordHash, loginMethod: "email" })
        .where(eq(users.id, admin.id));
    } catch (err) {
      console.warn(`[seedStaffUsers] Failed to update admin ${admin.name}:`, err);
    }
  }

  // 担当者スタッフのシード
  const staffList = [
    { openId: "staff-takayama", name: "高山" },
    { openId: "staff-okubo", name: "大久保" },
    { openId: "staff-yamagishi", name: "山岸" },
  ];
  for (const staff of staffList) {
    try {
      await db
        .insert(users)
        .values({
          openId: staff.openId,
          name: staff.name,
          email: SHARED_EMAIL,
          passwordHash,
          loginMethod: "email",
          role: "user",
          lastSignedIn: new Date(),
        })
        .onDuplicateKeyUpdate({ set: { name: staff.name, email: SHARED_EMAIL, passwordHash, loginMethod: "email" } });
    } catch (err) {
      console.warn(`[seedStaffUsers] Failed to seed ${staff.name}:`, err);
    }
  }
  console.log("[seedStaffUsers] Staff users seeded with email login: 高山, 大久保, 山岸");
}
