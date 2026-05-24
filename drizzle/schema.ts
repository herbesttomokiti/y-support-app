import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  bigint,
  boolean,
  json,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  passwordHash: varchar("passwordHash", { length: 255 }), // メールログイン用
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// 作業テンプレート（管理者が作成・保存）
export const taskTemplates = mysqlTable("task_templates", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  clientName: varchar("clientName", { length: 255 }),
  description: text("description").notNull(),
  estimatedMinutes: int("estimatedMinutes").default(30),
  steps: json("steps").notNull(), // { order: number, instruction: string, checkItems: string[] }[]
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TaskTemplate = typeof taskTemplates.$inferSelect;
export type InsertTaskTemplate = typeof taskTemplates.$inferInsert;

// 作業カード（管理者が担当者に送信する個別の作業指示）
export const tasks = mysqlTable("tasks", {
  id: int("id").autoincrement().primaryKey(),
  templateId: int("templateId"),
  assignedTo: int("assignedTo").notNull(), // 担当者のユーザーID
  createdBy: int("createdBy").notNull(),   // 管理者のユーザーID
  name: varchar("name", { length: 255 }).notNull(),
  clientName: varchar("clientName", { length: 255 }),
  description: text("description"),
  estimatedMinutes: int("estimatedMinutes").default(30),
  steps: json("steps").notNull(), // { order: number, instruction: string, checkItems: string[] }[]
  status: mysqlEnum("status", ["pending", "in_progress", "completed"]).default("pending").notNull(),
  scheduledDate: timestamp("scheduledDate"),
  instructionFileUrl: varchar("instructionFileUrl", { length: 1024 }), // 指示書ファイルURL
  instructionFileKey: varchar("instructionFileKey", { length: 512 }),  // S3キー
  instructionFileName: varchar("instructionFileName", { length: 255 }), // 元ファイル名
  instructionFileType: varchar("instructionFileType", { length: 32 }),  // pdf/image/excel/text
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Task = typeof tasks.$inferSelect;
export type InsertTask = typeof tasks.$inferInsert;

// 作業セッション（担当者が実際に作業した記録）
export const taskSessions = mysqlTable("task_sessions", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(),
  userId: int("userId").notNull(),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  actualMinutes: int("actualMinutes"),
  panicButtonCount: int("panicButtonCount").default(0).notNull(), // 「迷ったら押す」使用回数
  currentStepOrder: int("currentStepOrder").default(0).notNull(),
  reportText: text("reportText"), // 自動生成された報告テンプレ
  sheetExported: boolean("sheetExported").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TaskSession = typeof taskSessions.$inferSelect;
export type InsertTaskSession = typeof taskSessions.$inferInsert;

// ステップ完了記録（各ステップの完了時刻・手書きメモ）
export const stepCompletions = mysqlTable("step_completions", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull(),
  taskId: int("taskId").notNull(),
  stepOrder: int("stepOrder").notNull(),
  completedAt: timestamp("completedAt").defaultNow().notNull(),
  memoImageKey: varchar("memoImageKey", { length: 512 }), // S3キー
  memoImageUrl: varchar("memoImageUrl", { length: 1024 }), // 表示用URL
  memoText: text("memoText"), // OCRや手動入力テキスト（将来用）
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type StepCompletion = typeof stepCompletions.$inferSelect;
export type InsertStepCompletion = typeof stepCompletions.$inferInsert;
