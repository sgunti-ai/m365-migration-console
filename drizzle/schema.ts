import { int, mysqlEnum, mysqlTable, text, timestamp, tinyint, varchar } from "drizzle-orm/mysql-core";

/** Core user table backing auth flow. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const migrationJobs = mysqlTable("migration_jobs", {
  id: varchar("id", { length: 32 }).primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  workload: varchar("workload", { length: 32 }).notNull(),
  scope: varchar("scope", { length: 255 }).notNull(),
  ownerOpenId: varchar("ownerOpenId", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["Queued", "Running", "Paused", "Completed", "Needs review", "Failed", "Cancelled"]).default("Queued").notNull(),
  progress: int("progress").default(0).notNull(),
  itemsDone: int("itemsDone").default(0).notNull(),
  itemsTotal: int("itemsTotal").default(0).notNull(),
  throughputGbHr: int("throughputGbHr").default(0).notNull(),
  eta: varchar("eta", { length: 64 }).default("Queued").notNull(),
  concurrency: varchar("concurrency", { length: 32 }).default("Balanced").notNull(),
  batchMode: tinyint("batchMode").default(0).notNull(),
  batchSize: varchar("batchSize", { length: 64 }),
  schedule: varchar("schedule", { length: 64 }),
  scheduledAt: timestamp("scheduledAt"),
  checkpoint: text("checkpoint"),
  lastError: text("lastError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const migrationJobEvents = mysqlTable("migration_job_events", {
  id: int("id").autoincrement().primaryKey(),
  jobId: varchar("jobId", { length: 32 }).notNull(),
  type: varchar("type", { length: 64 }).notNull(),
  payload: text("payload").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type MigrationJob = typeof migrationJobs.$inferSelect;
export type InsertMigrationJob = typeof migrationJobs.$inferInsert;
export type MigrationJobEvent = typeof migrationJobEvents.$inferSelect;
