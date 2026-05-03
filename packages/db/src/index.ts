import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

export type MigrationRecord = {
  id: string;
  applied: boolean;
};

export type MigrationSummary = {
  databasePath: string;
  applied: MigrationRecord[];
};

export type DbContext = {
  db: DatabaseSync;
  transactionDepth: number;
};

export type CreateProjectInput = {
  id?: string;
  name: string;
  repoPath?: string;
  repoUrl?: string;
  gitProviderKind?: string;
  defaultBranch?: string;
};

export type ProjectRecord = {
  id: string;
  name: string;
  stateVersion: number;
};

export type CreateTaskInput = {
  id?: string;
  projectId: string;
  title: string;
  description?: string;
  sourceKind?: string;
  autonomy?: string;
};

export type TaskRecord = {
  id: string;
  projectId: string;
  title: string;
  status: string;
  stateVersion: number;
};

export type AppendEventInput = {
  type: string;
  summary: string;
  projectId?: string;
  taskId?: string;
  attemptId?: string;
  operationId?: string;
  transitionId?: string;
  payload?: unknown;
  artifactRefs?: string[];
  severity?: "debug" | "info" | "warn" | "error";
};

export type EventRecord = {
  id: number;
  type: string;
  summary: string;
  projectId?: string;
  taskId?: string;
  severity: string;
  payload?: unknown;
  artifactRefs: string[];
  createdAt: string;
};

export type CreateOperationInput = {
  id?: string;
  idempotencyKey: string;
  kind: string;
  projectId?: string;
  taskId?: string;
  attemptId?: string;
  prId?: string;
  externalId?: string;
};

export type OperationRecord = {
  id: string;
  idempotencyKey: string;
  kind: string;
  status: string;
  prId?: string;
};

export type AcquireLockInput = {
  resourceKind: string;
  resourceId: string;
  owner: string;
  ttlMs: number;
  now?: Date;
};

export type LockRecord = {
  id: string;
  resourceKind: string;
  resourceId: string;
  owner: string;
  lockToken: string;
  leaseVersion: number;
  expiresAt: string;
};

export class CasConflictError extends Error {
  constructor(message = "CAS conflict") {
    super(message);
    this.name = "CasConflictError";
  }
}

export class ActiveResourceConflictError extends Error {
  constructor(message = "active resource conflict") {
    super(message);
    this.name = "ActiveResourceConflictError";
  }
}

const moduleDir = dirname(fileURLToPath(import.meta.url));

export function defaultMigrationsDir(): string {
  return join(moduleDir, "..", "migrations");
}

export function openDatabase(databasePath: string): DatabaseSync {
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  return db;
}

export function runMigrations(databasePath: string, migrationsDir = defaultMigrationsDir()): MigrationSummary {
  const db = openDatabase(databasePath);
  try {
    ensureMigrationTable(db);
    const files = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    const applied: MigrationRecord[] = [];
    db.exec("BEGIN");
    try {
      for (const file of files) {
        const exists = db.prepare("SELECT 1 FROM schema_migrations WHERE id = ?").get(file);
        if (exists) {
          applied.push({ id: file, applied: false });
          continue;
        }

        const sql = readFileSync(join(migrationsDir, file), "utf8");
        // migration 与记录放在同一事务中，保证重启后能明确知道执行边界。
        db.exec(sql);
        db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(file);
        applied.push({ id: file, applied: true });
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return { databasePath, applied };
  } finally {
    db.close();
  }
}

export function withDatabase<T>(databasePath: string, fn: (context: DbContext) => T): T {
  const db = openDatabase(databasePath);
  try {
    return fn({ db, transactionDepth: 0 });
  } finally {
    db.close();
  }
}

export function withTransaction<T>(context: DbContext, fn: () => T): T {
  if (context.transactionDepth > 0) {
    context.transactionDepth += 1;
    try {
      return fn();
    } finally {
      context.transactionDepth -= 1;
    }
  }

  context.db.exec("BEGIN");
  context.transactionDepth = 1;
  try {
    const result = fn();
    context.db.exec("COMMIT");
    context.transactionDepth = 0;
    return result;
  } catch (error) {
    context.db.exec("ROLLBACK");
    context.transactionDepth = 0;
    throw error;
  }
}

export function createProject(context: DbContext, input: CreateProjectInput): ProjectRecord {
  return withTransaction(context, () => insertProject(context, input));
}

export function createTask(context: DbContext, input: CreateTaskInput): TaskRecord {
  return withTransaction(context, () => insertTask(context, input));
}

export function updateTaskStatus(
  context: DbContext,
  taskId: string,
  expectedStateVersion: number,
  status: string
): TaskRecord {
  return withTransaction(context, () => {
    const result = context.db
      .prepare(
        `UPDATE tasks
         SET status = ?, state_version = state_version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND state_version = ?`
      )
      .run(status, taskId, expectedStateVersion);

    if (result.changes === 0) {
      throw new CasConflictError(`task ${taskId} state_version mismatch`);
    }

    const task = requireTask(context, taskId);
    appendEvent(context, {
      type: "task.status_updated",
      summary: `task status updated to ${status}`,
      projectId: task.projectId,
      taskId: task.id,
      payload: { status, stateVersion: task.stateVersion }
    });
    return task;
  });
}

export function appendEvent(context: DbContext, input: AppendEventInput): EventRecord {
  const result = context.db
    .prepare(
      `INSERT INTO events (
        operation_id, transition_id, project_id, task_id, attempt_id, type, summary,
        payload_json, artifact_refs_json, severity
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.operationId ?? null,
      input.transitionId ?? null,
      input.projectId ?? null,
      input.taskId ?? null,
      input.attemptId ?? null,
      input.type,
      input.summary,
      input.payload === undefined ? null : JSON.stringify(input.payload),
      input.artifactRefs === undefined ? null : JSON.stringify(input.artifactRefs),
      input.severity ?? "info"
    );

  return requireEvent(context, Number(result.lastInsertRowid));
}

export function listTaskEvents(context: DbContext, taskId: string): EventRecord[] {
  return context.db
    .prepare(
      `SELECT * FROM events
       WHERE task_id = ?
       ORDER BY created_at ASC, id ASC`
    )
    .all(taskId)
    .map(mapEventRow);
}

export function createOperation(context: DbContext, input: CreateOperationInput): OperationRecord {
  return withTransaction(context, () => {
    const existing = findOperationByIdempotencyKey(context, input.idempotencyKey);
    if (existing) {
      return existing;
    }

    if (input.kind === "merge" && !input.prId) {
      throw new Error("merge operation requires prId");
    }

    const id = input.id ?? randomUUID();
    try {
      context.db
        .prepare(
          `INSERT INTO operations (id, idempotency_key, kind, project_id, task_id, attempt_id, pr_id, external_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.idempotencyKey,
          input.kind,
          input.projectId ?? null,
          input.taskId ?? null,
          input.attemptId ?? null,
          input.prId ?? null,
          input.externalId ?? null
        );
    } catch (error) {
      if (isSqliteConstraint(error)) {
        const reused = findOperationByIdempotencyKey(context, input.idempotencyKey);
        if (reused) {
          return reused;
        }
      }
      throw error;
    }

    return requireOperationById(context, id);
  });
}

export function acquireLock(context: DbContext, input: AcquireLockInput): LockRecord {
  return withTransaction(context, () => {
    const now = input.now ?? new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + input.ttlMs).toISOString();
    const existing = findLock(context, input.resourceKind, input.resourceId);

    if (!existing) {
      context.db
        .prepare(
          `INSERT INTO locks (id, resource_kind, resource_id, owner, lock_token, expires_at, heartbeat_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(randomUUID(), input.resourceKind, input.resourceId, input.owner, randomUUID(), expiresAt, nowIso);
      return requireLock(context, input.resourceKind, input.resourceId);
    }

    if (Date.parse(existing.expiresAt) > now.getTime()) {
      throw new ActiveResourceConflictError(`lock is held: ${input.resourceKind}:${input.resourceId}`);
    }

    context.db
      .prepare(
        `UPDATE locks
         SET owner = ?, lock_token = ?, lease_version = lease_version + 1,
             expires_at = ?, heartbeat_at = ?, updated_at = CURRENT_TIMESTAMP
         WHERE resource_kind = ? AND resource_id = ?`
      )
      .run(input.owner, randomUUID(), expiresAt, nowIso, input.resourceKind, input.resourceId);
    return requireLock(context, input.resourceKind, input.resourceId);
  });
}

export function releaseLock(context: DbContext, resourceKind: string, resourceId: string, lockToken: string): boolean {
  return withTransaction(context, () => {
    const result = context.db
      .prepare("DELETE FROM locks WHERE resource_kind = ? AND resource_id = ? AND lock_token = ?")
      .run(resourceKind, resourceId, lockToken);
    return result.changes === 1;
  });
}

function ensureMigrationTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function insertProject(context: DbContext, input: CreateProjectInput): ProjectRecord {
  const id = input.id ?? randomUUID();
  context.db
    .prepare(
      `INSERT INTO projects (id, name, repo_path, repo_url, git_provider_kind, default_branch)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.name,
      input.repoPath ?? null,
      input.repoUrl ?? null,
      input.gitProviderKind ?? null,
      input.defaultBranch ?? null
    );

  appendEvent(context, {
    type: "project.created",
    summary: `project created: ${input.name}`,
    projectId: id
  });

  return requireProject(context, id);
}

function insertTask(context: DbContext, input: CreateTaskInput): TaskRecord {
  const id = input.id ?? randomUUID();
  context.db
    .prepare(
      `INSERT INTO tasks (id, project_id, source_kind, title, description, autonomy)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.projectId,
      input.sourceKind ?? "manual",
      input.title,
      input.description ?? "",
      input.autonomy ?? "balanced"
    );

  appendEvent(context, {
    type: "task.created",
    summary: `task created: ${input.title}`,
    projectId: input.projectId,
    taskId: id
  });

  return requireTask(context, id);
}

function requireProject(context: DbContext, id: string): ProjectRecord {
  const row = context.db.prepare("SELECT id, name, state_version FROM projects WHERE id = ?").get(id);
  if (!row) {
    throw new Error(`project not found: ${id}`);
  }
  return mapProjectRow(row);
}

function requireTask(context: DbContext, id: string): TaskRecord {
  const row = context.db
    .prepare("SELECT id, project_id, title, status, state_version FROM tasks WHERE id = ?")
    .get(id);
  if (!row) {
    throw new Error(`task not found: ${id}`);
  }
  return mapTaskRow(row);
}

function requireEvent(context: DbContext, id: number): EventRecord {
  const row = context.db.prepare("SELECT * FROM events WHERE id = ?").get(id);
  if (!row) {
    throw new Error(`event not found: ${id}`);
  }
  return mapEventRow(row);
}

function requireOperationByIdempotencyKey(context: DbContext, idempotencyKey: string): OperationRecord {
  const row = context.db
    .prepare("SELECT id, idempotency_key, kind, status FROM operations WHERE idempotency_key = ?")
    .get(idempotencyKey);
  if (!row) {
    throw new Error(`operation not found: ${idempotencyKey}`);
  }
  return mapOperationRow(row);
}

function findOperationByIdempotencyKey(context: DbContext, idempotencyKey: string): OperationRecord | undefined {
  const row = context.db
    .prepare("SELECT id, idempotency_key, kind, status, pr_id FROM operations WHERE idempotency_key = ?")
    .get(idempotencyKey);
  return row ? mapOperationRow(row) : undefined;
}

function requireOperationById(context: DbContext, id: string): OperationRecord {
  const row = context.db
    .prepare("SELECT id, idempotency_key, kind, status, pr_id FROM operations WHERE id = ?")
    .get(id);
  if (!row) {
    throw new Error(`operation not found: ${id}`);
  }
  return mapOperationRow(row);
}

function findLock(context: DbContext, resourceKind: string, resourceId: string): LockRecord | undefined {
  const row = context.db
    .prepare("SELECT * FROM locks WHERE resource_kind = ? AND resource_id = ?")
    .get(resourceKind, resourceId);
  return row ? mapLockRow(row) : undefined;
}

function requireLock(context: DbContext, resourceKind: string, resourceId: string): LockRecord {
  const lock = findLock(context, resourceKind, resourceId);
  if (!lock) {
    throw new Error(`lock not found: ${resourceKind}:${resourceId}`);
  }
  return lock;
}

function mapProjectRow(row: unknown): ProjectRecord {
  const value = row as { id: string; name: string; state_version: number };
  return { id: value.id, name: value.name, stateVersion: value.state_version };
}

function mapTaskRow(row: unknown): TaskRecord {
  const value = row as { id: string; project_id: string; title: string; status: string; state_version: number };
  return {
    id: value.id,
    projectId: value.project_id,
    title: value.title,
    status: value.status,
    stateVersion: value.state_version
  };
}

function mapEventRow(row: unknown): EventRecord {
  const value = row as {
    id: number;
    type: string;
    summary: string;
    project_id: string | null;
    task_id: string | null;
    severity: string;
    payload_json: string | null;
    artifact_refs_json: string | null;
    created_at: string;
  };
  return {
    id: value.id,
    type: value.type,
    summary: value.summary,
    projectId: value.project_id ?? undefined,
    taskId: value.task_id ?? undefined,
    severity: value.severity,
    payload: value.payload_json ? JSON.parse(value.payload_json) : undefined,
    artifactRefs: value.artifact_refs_json ? (JSON.parse(value.artifact_refs_json) as string[]) : [],
    createdAt: value.created_at
  };
}

function mapOperationRow(row: unknown): OperationRecord {
  const value = row as { id: string; idempotency_key: string; kind: string; status: string; pr_id?: string | null };
  return {
    id: value.id,
    idempotencyKey: value.idempotency_key,
    kind: value.kind,
    status: value.status,
    prId: value.pr_id ?? undefined
  };
}

function mapLockRow(row: unknown): LockRecord {
  const value = row as {
    id: string;
    resource_kind: string;
    resource_id: string;
    owner: string;
    lock_token: string;
    lease_version: number;
    expires_at: string;
  };
  return {
    id: value.id,
    resourceKind: value.resource_kind,
    resourceId: value.resource_id,
    owner: value.owner,
    lockToken: value.lock_token,
    leaseVersion: value.lease_version,
    expiresAt: value.expires_at
  };
}

function isSqliteConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes("constraint");
}
