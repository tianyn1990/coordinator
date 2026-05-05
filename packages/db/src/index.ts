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
  gitProviderHost?: string;
  defaultBranch?: string;
  prProviderKind?: string;
  workspaceRoot?: string;
  workflowLauncher?: string;
  outerAgentDefaultProvider?: string;
  innerAgentDefaultProvider?: string;
  registrationStatus?: string;
  registryNotes?: unknown;
};

export type ProjectRecord = {
  id: string;
  name: string;
  repoPath?: string;
  repoUrl?: string;
  gitProviderKind?: string;
  gitProviderHost?: string;
  defaultBranch?: string;
  prProviderKind?: string;
  workspaceRoot?: string;
  workflowLauncher?: string;
  outerAgentDefaultProvider?: string;
  innerAgentDefaultProvider?: string;
  registrationStatus?: string;
  registryNotes?: unknown;
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
  sourceKind: string;
  title: string;
  description: string;
  autonomy: string;
  status: string;
  stateVersion: number;
};

export type TaskListRecord = TaskRecord & {
  projectName: string;
  updatedAt: string;
};

export type CreateAttemptInput = {
  id?: string;
  projectId: string;
  taskId: string;
  reason?: string;
};

export type AttemptRecord = {
  id: string;
  projectId: string;
  taskId: string;
  status: string;
  reason: string;
  stateVersion: number;
};

export type CreateExecutionPlanInput = {
  id?: string;
  projectId: string;
  taskId: string;
  attemptId?: string;
  status?: string;
  artifactPath?: string;
};

export type ExecutionPlanRecord = {
  id: string;
  projectId: string;
  taskId: string;
  attemptId?: string;
  status: string;
  artifactPath?: string;
  stateVersion: number;
};

export type CreateHumanRequestInput = {
  id?: string;
  projectId: string;
  taskId: string;
  attemptId?: string;
  prId?: string;
  blockedKey: string;
  kind: string;
  status?: string;
  questionArtifactPath?: string;
  answerArtifactPath?: string;
  approvalSnapshot?: MergeApprovalSnapshotInput;
};

export type HumanRequestRecord = {
  id: string;
  projectId: string;
  taskId: string;
  attemptId?: string;
  prId?: string;
  blockedKey: string;
  kind: string;
  status: string;
  questionArtifactPath?: string;
  answerArtifactPath?: string;
  approvalPrHeadSha?: string;
  approvalPrBaseSha?: string;
  approvalValidationRunId?: string;
  approvalMergeStrategy?: string;
  approvalValid: boolean;
  approvedBy?: string;
  approvedAt?: string;
  stateVersion: number;
};

export type UpdateHumanRequestInput = {
  humanRequestId: string;
  expectedStateVersion: number;
  status: string;
  answerArtifactPath?: string;
  approvalSnapshot?: MergeApprovalSnapshotInput;
  approvedBy?: string;
  approvedAt?: string;
};

export type MergeApprovalSnapshotInput = {
  headSha?: string;
  baseSha?: string;
  validationRunId?: string;
  mergeStrategy?: string;
  valid?: boolean;
};

export type CreateWorkspaceInput = {
  id?: string;
  projectId: string;
  taskId: string;
  attemptId: string;
  status?: string;
  workspacePath?: string;
  repoPath?: string;
  branch?: string;
  baseBranch?: string;
};

export type WorkspaceRecord = {
  id: string;
  projectId: string;
  taskId: string;
  attemptId: string;
  status: string;
  workspacePath?: string;
  repoPath?: string;
  branch?: string;
  baseBranch?: string;
  stateVersion: number;
};

export type UpdateWorkspaceInput = {
  workspaceId: string;
  expectedStateVersion: number;
  status: string;
  workspacePath?: string;
  repoPath?: string;
  branch?: string;
  baseBranch?: string;
  lock?: {
    resourceKind: string;
    resourceId: string;
    lockToken: string;
    now?: Date;
  };
};

export type CreateWorkflowRunInput = {
  id?: string;
  projectId: string;
  taskId: string;
  attemptId: string;
  profileId: string;
  status?: string;
  externalId?: string;
  handoffKind?: string;
};

export type CreateAgentSessionInput = {
  id?: string;
  projectId: string;
  taskId?: string;
  attemptId?: string;
  providerKind: string;
  role: string;
  status?: string;
  transcriptPath?: string;
  promptPath?: string;
  surfaceJsonPath?: string;
  surfaceMarkdownPath?: string;
  finalResponsePath?: string;
};

export type AgentSessionRecord = {
  id: string;
  projectId: string;
  taskId?: string;
  attemptId?: string;
  providerKind: string;
  role: string;
  status: string;
  transcriptPath?: string;
  promptPath?: string;
  surfaceJsonPath?: string;
  surfaceMarkdownPath?: string;
  finalResponsePath?: string;
  stateVersion: number;
};

export type UpdateAgentSessionInput = {
  agentSessionId: string;
  expectedStateVersion: number;
  status: string;
  transcriptPath?: string;
  promptPath?: string;
  surfaceJsonPath?: string;
  surfaceMarkdownPath?: string;
  finalResponsePath?: string;
  lock?: {
    resourceKind: string;
    resourceId: string;
    lockToken: string;
    now?: Date;
  };
};

export type WorkflowRunRecord = {
  id: string;
  projectId: string;
  taskId: string;
  attemptId: string;
  profileId: string;
  status: string;
  externalId?: string;
  handoffKind?: string;
  stateVersion: number;
};

export type CreatePullRequestInput = {
  id?: string;
  projectId: string;
  taskId: string;
  attemptId?: string;
  providerKind: string;
  externalId?: string;
  url?: string;
  status?: string;
  headBranch?: string;
  baseBranch?: string;
  headSha?: string;
  baseSha?: string;
  title?: string;
  bodyArtifactPath?: string;
  reviewStatus?: string;
  reviewSummary?: string;
  validationRunId?: string;
  mergeStrategy?: string;
  mergedAt?: string;
};

export type PullRequestRecord = {
  id: string;
  projectId: string;
  taskId: string;
  attemptId?: string;
  providerKind: string;
  externalId?: string;
  url?: string;
  status: string;
  headBranch?: string;
  baseBranch?: string;
  headSha?: string;
  baseSha?: string;
  title?: string;
  bodyArtifactPath?: string;
  reviewStatus: string;
  reviewSummary?: string;
  validationRunId?: string;
  mergeStrategy?: string;
  mergedAt?: string;
  stateVersion: number;
};

export type UpdatePullRequestInput = {
  prId: string;
  expectedStateVersion: number;
  status?: string;
  externalId?: string;
  url?: string;
  headBranch?: string;
  baseBranch?: string;
  headSha?: string;
  baseSha?: string;
  title?: string;
  bodyArtifactPath?: string;
  reviewStatus?: string;
  reviewSummary?: string;
  validationRunId?: string;
  mergeStrategy?: string;
  mergedAt?: string;
};

export type UpdateWorkflowRunInput = {
  workflowRunId: string;
  expectedStateVersion: number;
  status: string;
  externalId?: string;
  handoffKind?: string;
  lock?: {
    resourceKind: string;
    resourceId: string;
    lockToken: string;
    now?: Date;
  };
};

export type CreateArtifactInput = {
  id?: string;
  projectId?: string;
  taskId?: string;
  attemptId?: string;
  kind: string;
  owner: string;
  path: string;
  eventId?: number;
};

export type ArtifactRecord = {
  id: string;
  projectId?: string;
  taskId?: string;
  attemptId?: string;
  kind: string;
  owner: string;
  path: string;
};

export type AppendEventInput = {
  type: string;
  summary: string;
  projectId?: string;
  taskId?: string;
  attemptId?: string;
  workspaceId?: string;
  agentSessionId?: string;
  workflowRunId?: string;
  prId?: string;
  humanRequestId?: string;
  operationId?: string;
  transitionId?: string;
  lockToken?: string;
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
  attemptId?: string;
  workspaceId?: string;
  agentSessionId?: string;
  workflowRunId?: string;
  prId?: string;
  humanRequestId?: string;
  operationId?: string;
  severity: string;
  payload?: unknown;
  artifactRefs: string[];
  createdAt: string;
};

export type ListTasksInput = {
  statuses?: string[];
  limit?: number;
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
  projectId?: string;
  taskId?: string;
  attemptId?: string;
  prId?: string;
  externalId?: string;
  failureCode?: string;
  lastObservedState?: unknown;
};

export type UpdateOperationInput = {
  operationId: string;
  status: "planned" | "running" | "succeeded" | "failed" | "unknown" | "reconciled" | "canceled";
  externalId?: string;
  failureCode?: string;
  lastObservedState?: unknown;
  now?: Date;
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

export type ReleaseLockIfVersionInput = {
  resourceKind: string;
  resourceId: string;
  lockToken: string;
  leaseVersion: number;
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

export function getProject(context: DbContext, id: string): ProjectRecord | undefined {
  const row = context.db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  return row ? mapProjectRow(row) : undefined;
}

export function listProjects(context: DbContext): ProjectRecord[] {
  return context.db
    .prepare("SELECT * FROM projects ORDER BY created_at ASC, id ASC")
    .all()
    .map(mapProjectRow);
}

export function createTask(context: DbContext, input: CreateTaskInput): TaskRecord {
  return withTransaction(context, () => insertTask(context, input));
}

export function getTask(context: DbContext, id: string): TaskRecord | undefined {
  const row = context.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  return row ? mapTaskRow(row) : undefined;
}

export function listTasks(context: DbContext, input: ListTasksInput = {}): TaskRecord[] {
  const limit = input.limit ?? 50;
  if (input.statuses && input.statuses.length > 0) {
    const placeholders = input.statuses.map(() => "?").join(", ");
    return context.db
      .prepare(
        `SELECT * FROM tasks
         WHERE status IN (${placeholders})
         ORDER BY updated_at ASC, created_at ASC, id ASC
         LIMIT ?`
      )
      .all(...input.statuses, limit)
      .map(mapTaskRow);
  }

  return context.db
    .prepare(
      `SELECT * FROM tasks
       ORDER BY updated_at ASC, created_at ASC, id ASC
       LIMIT ?`
    )
    .all(limit)
    .map(mapTaskRow);
}

export function listTasksForOperator(context: DbContext, input: ListTasksInput = {}): TaskListRecord[] {
  const limit = input.limit ?? 50;
  if (input.statuses && input.statuses.length > 0) {
    const placeholders = input.statuses.map(() => "?").join(", ");
    return context.db
      .prepare(
        `SELECT tasks.*, projects.name AS project_name, tasks.updated_at AS task_updated_at
         FROM tasks
         JOIN projects ON projects.id = tasks.project_id
         WHERE tasks.status IN (${placeholders})
         ORDER BY tasks.updated_at DESC, tasks.created_at DESC, tasks.id ASC
         LIMIT ?`
      )
      .all(...input.statuses, limit)
      .map(mapTaskListRow);
  }

  return context.db
    .prepare(
      `SELECT tasks.*, projects.name AS project_name, tasks.updated_at AS task_updated_at
       FROM tasks
       JOIN projects ON projects.id = tasks.project_id
       ORDER BY tasks.updated_at DESC, tasks.created_at DESC, tasks.id ASC
       LIMIT ?`
    )
    .all(limit)
    .map(mapTaskListRow);
}

export function createAttempt(context: DbContext, input: CreateAttemptInput): AttemptRecord {
  return withTransaction(context, () => insertAttempt(context, input));
}

export function getAttempt(context: DbContext, id: string): AttemptRecord | undefined {
  const row = context.db.prepare("SELECT * FROM attempts WHERE id = ?").get(id);
  return row ? mapAttemptRow(row) : undefined;
}

export function getLatestAttemptByTask(context: DbContext, taskId: string): AttemptRecord | undefined {
  const row = context.db
    .prepare(
      `SELECT * FROM attempts
       WHERE task_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    )
    .get(taskId);
  return row ? mapAttemptRow(row) : undefined;
}

export function createExecutionPlan(context: DbContext, input: CreateExecutionPlanInput): ExecutionPlanRecord {
  return withTransaction(context, () => insertExecutionPlan(context, input));
}

export function getLatestExecutionPlanByTask(context: DbContext, taskId: string): ExecutionPlanRecord | undefined {
  const row = context.db
    .prepare(
      `SELECT * FROM execution_plans
       WHERE task_id = ? AND status IN ('draft', 'active', 'revised')
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    )
    .get(taskId);
  return row ? mapExecutionPlanRow(row) : undefined;
}

export function createHumanRequest(context: DbContext, input: CreateHumanRequestInput): HumanRequestRecord {
  return withTransaction(context, () => insertHumanRequest(context, input));
}

export function listHumanRequestsByTask(context: DbContext, taskId: string, limit = 5): HumanRequestRecord[] {
  return context.db
    .prepare(
      `SELECT * FROM human_requests
       WHERE task_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(taskId, limit)
    .map(mapHumanRequestRow);
}

export function getHumanRequest(context: DbContext, id: string): HumanRequestRecord | undefined {
  const row = context.db.prepare("SELECT * FROM human_requests WHERE id = ?").get(id);
  return row ? mapHumanRequestRow(row) : undefined;
}

export function listHumanRequestsByStatus(context: DbContext, statuses: string[], limit = 50): HumanRequestRecord[] {
  if (statuses.length === 0) {
    return [];
  }
  const placeholders = statuses.map(() => "?").join(", ");
  return context.db
    .prepare(
      `SELECT * FROM human_requests
       WHERE status IN (${placeholders})
       ORDER BY updated_at ASC, created_at ASC, id ASC
       LIMIT ?`
    )
    .all(...statuses, limit)
    .map(mapHumanRequestRow);
}

export function createWorkspace(context: DbContext, input: CreateWorkspaceInput): WorkspaceRecord {
  return withTransaction(context, () => insertWorkspace(context, input));
}

export function getWorkspace(context: DbContext, id: string): WorkspaceRecord | undefined {
  const row = context.db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id);
  return row ? mapWorkspaceRow(row) : undefined;
}

export function getActiveWorkspaceByAttempt(context: DbContext, attemptId: string): WorkspaceRecord | undefined {
  const row = context.db
    .prepare(
      `SELECT * FROM workspaces
       WHERE attempt_id = ? AND status IN ('planned', 'creating', 'ready', 'dirty')
       ORDER BY created_at ASC, id ASC
       LIMIT 1`
    )
    .get(attemptId);
  return row ? mapWorkspaceRow(row) : undefined;
}

export function getOperatorWorkspaceByAttempt(context: DbContext, attemptId: string): WorkspaceRecord | undefined {
  const row = context.db
    .prepare(
      `SELECT * FROM workspaces
       WHERE attempt_id = ? AND status IN ('planned', 'creating', 'ready', 'dirty', 'blocked')
       ORDER BY created_at ASC, id ASC
       LIMIT 1`
    )
    .get(attemptId);
  return row ? mapWorkspaceRow(row) : undefined;
}

export function listWorkspacesByStatus(context: DbContext, statuses: string[], limit = 50): WorkspaceRecord[] {
  if (statuses.length === 0) {
    return [];
  }
  const placeholders = statuses.map(() => "?").join(", ");
  return context.db
    .prepare(
      `SELECT * FROM workspaces
       WHERE status IN (${placeholders})
       ORDER BY updated_at ASC, created_at ASC, id ASC
       LIMIT ?`
    )
    .all(...statuses, limit)
    .map(mapWorkspaceRow);
}

export function createWorkflowRun(context: DbContext, input: CreateWorkflowRunInput): WorkflowRunRecord {
  return withTransaction(context, () => insertWorkflowRun(context, input));
}

export function createAgentSession(context: DbContext, input: CreateAgentSessionInput): AgentSessionRecord {
  return withTransaction(context, () => insertAgentSession(context, input));
}

export function getAgentSession(context: DbContext, id: string): AgentSessionRecord | undefined {
  const row = context.db.prepare("SELECT * FROM agent_sessions WHERE id = ?").get(id);
  return row ? mapAgentSessionRow(row) : undefined;
}

export function getActiveAgentSessionByTask(
  context: DbContext,
  taskId: string,
  role = "outer"
): AgentSessionRecord | undefined {
  const row = context.db
    .prepare(
      `SELECT * FROM agent_sessions
       WHERE task_id = ? AND role = ? AND status IN ('planned', 'starting', 'running', 'stalled', 'unknown')
       ORDER BY created_at ASC, id ASC
       LIMIT 1`
    )
    .get(taskId, role);
  return row ? mapAgentSessionRow(row) : undefined;
}

export function listAgentSessionsByTask(context: DbContext, taskId: string, limit = 5): AgentSessionRecord[] {
  return context.db
    .prepare(
      `SELECT * FROM agent_sessions
       WHERE task_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(taskId, limit)
    .map(mapAgentSessionRow);
}

export function getWorkflowRun(context: DbContext, id: string): WorkflowRunRecord | undefined {
  const row = context.db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id);
  return row ? mapWorkflowRunRow(row) : undefined;
}

export function listWorkflowRunsByTask(context: DbContext, taskId: string, limit = 5): WorkflowRunRecord[] {
  return context.db
    .prepare(
      `SELECT * FROM workflow_runs
       WHERE task_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(taskId, limit)
    .map(mapWorkflowRunRow);
}

export function createPullRequest(context: DbContext, input: CreatePullRequestInput): PullRequestRecord {
  return withTransaction(context, () => insertPullRequest(context, input));
}

export function getPullRequest(context: DbContext, id: string): PullRequestRecord | undefined {
  const row = context.db.prepare("SELECT * FROM pull_requests WHERE id = ?").get(id);
  return row ? mapPullRequestRow(row) : undefined;
}

export function getActivePullRequestByAttempt(context: DbContext, attemptId: string): PullRequestRecord | undefined {
  const row = context.db
    .prepare(
      `SELECT * FROM pull_requests
       WHERE attempt_id = ? AND status IN ('planned', 'creating', 'open', 'review', 'merge_waiting', 'merging')
       ORDER BY created_at ASC, id ASC
       LIMIT 1`
    )
    .get(attemptId);
  return row ? mapPullRequestRow(row) : undefined;
}

export function getLatestPullRequestByTask(context: DbContext, taskId: string): PullRequestRecord | undefined {
  const row = context.db
    .prepare(
      `SELECT * FROM pull_requests
       WHERE task_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    )
    .get(taskId);
  return row ? mapPullRequestRow(row) : undefined;
}

export function listPullRequestsByTask(context: DbContext, taskId: string, limit = 5): PullRequestRecord[] {
  return context.db
    .prepare(
      `SELECT * FROM pull_requests
       WHERE task_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(taskId, limit)
    .map(mapPullRequestRow);
}

export function updatePullRequest(context: DbContext, input: UpdatePullRequestInput): PullRequestRecord {
  return withTransaction(context, () => {
    const result = context.db
      .prepare(
        `UPDATE pull_requests
         SET status = COALESCE(?, status),
             external_id = COALESCE(?, external_id),
             url = COALESCE(?, url),
             head_branch = COALESCE(?, head_branch),
             base_branch = COALESCE(?, base_branch),
             head_sha = COALESCE(?, head_sha),
             base_sha = COALESCE(?, base_sha),
             title = COALESCE(?, title),
             body_artifact_path = COALESCE(?, body_artifact_path),
             review_status = COALESCE(?, review_status),
             review_summary = COALESCE(?, review_summary),
             validation_run_id = COALESCE(?, validation_run_id),
             merge_strategy = COALESCE(?, merge_strategy),
             merged_at = COALESCE(?, merged_at),
             state_version = state_version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND state_version = ?`
      )
      .run(
        input.status ?? null,
        input.externalId ?? null,
        input.url ?? null,
        input.headBranch ?? null,
        input.baseBranch ?? null,
        input.headSha ?? null,
        input.baseSha ?? null,
        input.title ?? null,
        input.bodyArtifactPath ?? null,
        input.reviewStatus ?? null,
        input.reviewSummary ?? null,
        input.validationRunId ?? null,
        input.mergeStrategy ?? null,
        input.mergedAt ?? null,
        input.prId,
        input.expectedStateVersion
      );

    if (result.changes === 0) {
      throw new CasConflictError(`pull request ${input.prId} state_version mismatch`);
    }

    return requirePullRequest(context, input.prId);
  });
}

export function listWorkflowRunsByStatus(context: DbContext, statuses: string[], limit = 50): WorkflowRunRecord[] {
  if (statuses.length === 0) {
    return [];
  }
  const placeholders = statuses.map(() => "?").join(", ");
  return context.db
    .prepare(
      `SELECT * FROM workflow_runs
       WHERE status IN (${placeholders})
       ORDER BY updated_at ASC, created_at ASC, id ASC
       LIMIT ?`
    )
    .all(...statuses, limit)
    .map(mapWorkflowRunRow);
}

export function getActiveWorkflowRunByAttempt(context: DbContext, attemptId: string): WorkflowRunRecord | undefined {
  const row = context.db
    .prepare(
      `SELECT * FROM workflow_runs
       WHERE attempt_id = ? AND status IN ('planned', 'starting', 'running', 'blocked', 'handoff', 'unknown')
       ORDER BY created_at ASC, id ASC
       LIMIT 1`
    )
    .get(attemptId);
  return row ? mapWorkflowRunRow(row) : undefined;
}

export function updateWorkflowRun(context: DbContext, input: UpdateWorkflowRunInput): WorkflowRunRecord {
  return withTransaction(context, () => {
    if (input.lock) {
      assertLockHeld(context, input.lock.resourceKind, input.lock.resourceId, input.lock.lockToken, input.lock.now);
    }

    const result = context.db
      .prepare(
        `UPDATE workflow_runs
         SET status = ?,
             external_id = COALESCE(?, external_id),
             handoff_kind = ?,
             state_version = state_version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND state_version = ?`
      )
      .run(
        input.status,
        input.externalId ?? null,
        input.handoffKind ?? null,
        input.workflowRunId,
        input.expectedStateVersion
      );

    if (result.changes === 0) {
      throw new CasConflictError(`workflow run ${input.workflowRunId} state_version mismatch`);
    }

    return requireWorkflowRun(context, input.workflowRunId);
  });
}

export function updateAgentSession(context: DbContext, input: UpdateAgentSessionInput): AgentSessionRecord {
  return withTransaction(context, () => {
    if (input.lock) {
      assertLockHeld(context, input.lock.resourceKind, input.lock.resourceId, input.lock.lockToken, input.lock.now);
    }

    const result = context.db
      .prepare(
        `UPDATE agent_sessions
         SET status = ?,
             transcript_path = COALESCE(?, transcript_path),
             prompt_path = COALESCE(?, prompt_path),
             surface_json_path = COALESCE(?, surface_json_path),
             surface_markdown_path = COALESCE(?, surface_markdown_path),
             final_response_path = COALESCE(?, final_response_path),
             state_version = state_version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND state_version = ?`
      )
      .run(
        input.status,
        input.transcriptPath ?? null,
        input.promptPath ?? null,
        input.surfaceJsonPath ?? null,
        input.surfaceMarkdownPath ?? null,
        input.finalResponsePath ?? null,
        input.agentSessionId,
        input.expectedStateVersion
      );

    if (result.changes === 0) {
      throw new CasConflictError(`agent session ${input.agentSessionId} state_version mismatch`);
    }

    return requireAgentSession(context, input.agentSessionId);
  });
}

export function updateWorkspace(context: DbContext, input: UpdateWorkspaceInput): WorkspaceRecord {
  return withTransaction(context, () => {
    if (input.lock) {
      assertLockHeld(context, input.lock.resourceKind, input.lock.resourceId, input.lock.lockToken, input.lock.now);
    }

    const result = context.db
      .prepare(
        `UPDATE workspaces
         SET status = ?, workspace_path = ?, repo_path = ?, branch = ?, base_branch = ?,
             state_version = state_version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND state_version = ?`
      )
      .run(
        input.status,
        input.workspacePath ?? null,
        input.repoPath ?? null,
        input.branch ?? null,
        input.baseBranch ?? null,
        input.workspaceId,
        input.expectedStateVersion
      );

    if (result.changes === 0) {
      throw new CasConflictError(`workspace ${input.workspaceId} state_version mismatch`);
    }

    return requireWorkspace(context, input.workspaceId);
  });
}

export function updateHumanRequest(context: DbContext, input: UpdateHumanRequestInput): HumanRequestRecord {
  return withTransaction(context, () => {
    const result = context.db
      .prepare(
        `UPDATE human_requests
         SET status = ?,
             answer_artifact_path = COALESCE(?, answer_artifact_path),
             approval_pr_head_sha = COALESCE(?, approval_pr_head_sha),
             approval_pr_base_sha = COALESCE(?, approval_pr_base_sha),
             approval_validation_run_id = COALESCE(?, approval_validation_run_id),
             approval_merge_strategy = COALESCE(?, approval_merge_strategy),
             approval_valid = COALESCE(?, approval_valid),
             approved_by = COALESCE(?, approved_by),
             approved_at = COALESCE(?, approved_at),
             state_version = state_version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND state_version = ?`
      )
      .run(
        input.status,
        input.answerArtifactPath ?? null,
        input.approvalSnapshot?.headSha ?? null,
        input.approvalSnapshot?.baseSha ?? null,
        input.approvalSnapshot?.validationRunId ?? null,
        input.approvalSnapshot?.mergeStrategy ?? null,
        input.approvalSnapshot?.valid === undefined ? null : input.approvalSnapshot.valid ? 1 : 0,
        input.approvedBy ?? null,
        input.approvedAt ?? null,
        input.humanRequestId,
        input.expectedStateVersion
      );

    if (result.changes === 0) {
      throw new CasConflictError(`human request ${input.humanRequestId} state_version mismatch`);
    }

    const request = requireHumanRequest(context, input.humanRequestId);
    appendEvent(context, {
      type: "human.request_updated",
      summary: `human request status updated to ${request.status}`,
      projectId: request.projectId,
      taskId: request.taskId,
      attemptId: request.attemptId,
      payload: {
        humanRequestId: request.id,
        status: request.status,
        answerArtifactPath: request.answerArtifactPath
      },
      artifactRefs: request.answerArtifactPath ? [request.answerArtifactPath] : undefined
    });
    return request;
  });
}

export function createArtifact(context: DbContext, input: CreateArtifactInput): ArtifactRecord {
  return withTransaction(context, () => {
    const id = input.id ?? randomUUID();
    context.db
      .prepare(
        `INSERT INTO artifacts (id, project_id, task_id, attempt_id, kind, owner, path, event_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.projectId ?? null,
        input.taskId ?? null,
        input.attemptId ?? null,
        input.kind,
        input.owner,
        input.path,
        input.eventId ?? null
      );
    return requireArtifact(context, id);
  });
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
        operation_id, transition_id, lock_token, project_id, task_id, attempt_id, workspace_id, agent_session_id,
        workflow_run_id, pr_id, human_request_id, type, summary,
        payload_json, artifact_refs_json, severity
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.operationId ?? null,
      input.transitionId ?? null,
      input.lockToken ?? null,
      input.projectId ?? null,
      input.taskId ?? null,
      input.attemptId ?? null,
      input.workspaceId ?? null,
      input.agentSessionId ?? null,
      input.workflowRunId ?? null,
      input.prId ?? null,
      input.humanRequestId ?? null,
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

export function getOperationByIdempotencyKey(context: DbContext, idempotencyKey: string): OperationRecord | undefined {
  return findOperationByIdempotencyKey(context, idempotencyKey);
}

export function getOperationById(context: DbContext, id: string): OperationRecord | undefined {
  const row = context.db.prepare("SELECT * FROM operations WHERE id = ?").get(id);
  return row ? mapOperationRow(row) : undefined;
}

export function listOperationsByStatus(context: DbContext, statuses: string[], limit = 50): OperationRecord[] {
  if (statuses.length === 0) {
    return [];
  }
  const placeholders = statuses.map(() => "?").join(", ");
  return context.db
    .prepare(
      `SELECT * FROM operations
       WHERE status IN (${placeholders})
       ORDER BY updated_at ASC, created_at ASC, id ASC
       LIMIT ?`
    )
    .all(...statuses, limit)
    .map(mapOperationRow);
}

export function listOperationsByStatusAndKindPrefix(
  context: DbContext,
  statuses: string[],
  kindPrefix: string,
  limit = 50
): OperationRecord[] {
  if (statuses.length === 0) {
    return [];
  }
  const placeholders = statuses.map(() => "?").join(", ");
  return context.db
    .prepare(
      `SELECT * FROM operations
       WHERE status IN (${placeholders}) AND kind LIKE ?
         AND (
           last_observed_state IS NULL
           OR json_extract(last_observed_state, '$.decision') IS NULL
           OR json_extract(last_observed_state, '$.reasonCode') IS NULL
         )
       ORDER BY updated_at ASC, created_at ASC, id ASC
       LIMIT ?`
    )
    .all(...statuses, `${kindPrefix}%`, limit)
    .map(mapOperationRow);
}

export function listOperationsByTask(context: DbContext, taskId: string, limit = 10): OperationRecord[] {
  return context.db
    .prepare(
      `SELECT * FROM operations
       WHERE task_id = ?
       ORDER BY updated_at DESC, created_at DESC, id DESC
       LIMIT ?`
    )
    .all(taskId, limit)
    .map(mapOperationRow);
}

export function updateOperation(context: DbContext, input: UpdateOperationInput): OperationRecord {
  return withTransaction(context, () => {
    const now = input.now ?? new Date();
    const existing = requireOperationById(context, input.operationId);
    if (isTerminalOperationStatus(existing.status) && existing.status !== input.status) {
      throw new ActiveResourceConflictError(`operation is terminal: ${input.operationId}:${existing.status}`);
    }
    const result = context.db
      .prepare(
        `UPDATE operations
         SET status = ?,
             external_id = COALESCE(?, external_id),
             failure_code = ?,
             last_observed_state = ?,
             started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN ? ELSE started_at END,
             completed_at = CASE WHEN ? IN ('succeeded', 'failed', 'unknown', 'reconciled', 'canceled') THEN ? ELSE completed_at END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(
        input.status,
        input.externalId ?? null,
        input.failureCode ?? null,
        input.lastObservedState === undefined ? null : JSON.stringify(input.lastObservedState),
        input.status,
        now.toISOString(),
        input.status,
        now.toISOString(),
        input.operationId
      );

    if (result.changes === 0) {
      throw new Error(`operation not found: ${input.operationId}`);
    }

    return requireOperationById(context, input.operationId);
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

export function releaseLockIfVersion(context: DbContext, input: ReleaseLockIfVersionInput): boolean {
  return withTransaction(context, () => {
    const result = context.db
      .prepare(
        `DELETE FROM locks
         WHERE resource_kind = ? AND resource_id = ? AND lock_token = ? AND lease_version = ?`
      )
      .run(input.resourceKind, input.resourceId, input.lockToken, input.leaseVersion);
    return result.changes === 1;
  });
}

export function getLock(context: DbContext, resourceKind: string, resourceId: string): LockRecord | undefined {
  return findLock(context, resourceKind, resourceId);
}

export function listExpiredLocks(context: DbContext, now = new Date(), limit = 50): LockRecord[] {
  return context.db
    .prepare(
      `SELECT * FROM locks
       WHERE expires_at <= ?
       ORDER BY expires_at ASC, updated_at ASC, id ASC
       LIMIT ?`
    )
    .all(now.toISOString(), limit)
    .map(mapLockRow);
}

export function assertLockHeld(
  context: DbContext,
  resourceKind: string,
  resourceId: string,
  lockToken: string,
  now = new Date()
): void {
  const lock = findLock(context, resourceKind, resourceId);
  if (!lock || lock.lockToken !== lockToken || Date.parse(lock.expiresAt) <= now.getTime()) {
    throw new ActiveResourceConflictError(`lock token mismatch: ${resourceKind}:${resourceId}`);
  }
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
      `INSERT INTO projects (
         id, name, repo_path, repo_url, git_provider_kind, git_provider_host, default_branch,
         pr_provider_kind, workspace_root, workflow_launcher, outer_agent_default_provider,
         inner_agent_default_provider, registration_status, registry_notes_json
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.name,
      input.repoPath ?? null,
      input.repoUrl ?? null,
      input.gitProviderKind ?? null,
      input.gitProviderHost ?? null,
      input.defaultBranch ?? null,
      input.prProviderKind ?? null,
      input.workspaceRoot ?? null,
      input.workflowLauncher ?? null,
      input.outerAgentDefaultProvider ?? null,
      input.innerAgentDefaultProvider ?? null,
      input.registrationStatus ?? "registered",
      input.registryNotes === undefined ? null : JSON.stringify(input.registryNotes)
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

function insertAttempt(context: DbContext, input: CreateAttemptInput): AttemptRecord {
  const id = input.id ?? randomUUID();
  context.db
    .prepare(
      `INSERT INTO attempts (id, project_id, task_id, reason)
       VALUES (?, ?, ?, ?)`
    )
    .run(id, input.projectId, input.taskId, input.reason ?? "initial");

  appendEvent(context, {
    type: "attempt.created",
    summary: `attempt created: ${id}`,
    projectId: input.projectId,
    taskId: input.taskId,
    attemptId: id
  });

  return requireAttempt(context, id);
}

function insertExecutionPlan(context: DbContext, input: CreateExecutionPlanInput): ExecutionPlanRecord {
  const id = input.id ?? randomUUID();
  context.db
    .prepare(
      `INSERT INTO execution_plans (id, project_id, task_id, attempt_id, status, artifact_path)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.projectId,
      input.taskId,
      input.attemptId ?? null,
      input.status ?? "active",
      input.artifactPath ?? null
    );

  appendEvent(context, {
    type: "execution_plan.created",
    summary: `execution plan created: ${id}`,
    projectId: input.projectId,
    taskId: input.taskId,
    attemptId: input.attemptId,
    payload: { status: input.status ?? "active", artifactPath: input.artifactPath },
    artifactRefs: input.artifactPath ? [input.artifactPath] : undefined
  });

  return requireExecutionPlan(context, id);
}

function insertHumanRequest(context: DbContext, input: CreateHumanRequestInput): HumanRequestRecord {
  const id = input.id ?? randomUUID();
  context.db
    .prepare(
      `INSERT INTO human_requests (
         id, project_id, task_id, attempt_id, pr_id, blocked_key, kind, status,
         question_artifact_path, answer_artifact_path,
         approval_pr_head_sha, approval_pr_base_sha, approval_validation_run_id,
         approval_merge_strategy, approval_valid, approved_by, approved_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.projectId,
      input.taskId,
      input.attemptId ?? null,
      input.prId ?? null,
      input.blockedKey,
      input.kind,
      input.status ?? "pending",
      input.questionArtifactPath ?? null,
      input.answerArtifactPath ?? null,
      input.approvalSnapshot?.headSha ?? null,
      input.approvalSnapshot?.baseSha ?? null,
      input.approvalSnapshot?.validationRunId ?? null,
      input.approvalSnapshot?.mergeStrategy ?? null,
      input.approvalSnapshot?.valid === undefined ? 1 : input.approvalSnapshot.valid ? 1 : 0,
      null,
      null
    );

  appendEvent(context, {
    type: "human.request_created",
    summary: `human request created: ${id}`,
    projectId: input.projectId,
    taskId: input.taskId,
    attemptId: input.attemptId,
    payload: {
      kind: input.kind,
      status: input.status ?? "pending",
      blockedKey: input.blockedKey,
      questionArtifactPath: input.questionArtifactPath,
      approvalSnapshot: input.approvalSnapshot
    },
    artifactRefs: input.questionArtifactPath ? [input.questionArtifactPath] : undefined
  });

  return requireHumanRequest(context, id);
}

function insertWorkspace(context: DbContext, input: CreateWorkspaceInput): WorkspaceRecord {
  const id = input.id ?? randomUUID();
  context.db
    .prepare(
      `INSERT INTO workspaces (
         id, project_id, task_id, attempt_id, status, workspace_path, repo_path, branch, base_branch
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.projectId,
      input.taskId,
      input.attemptId,
      input.status ?? "planned",
      input.workspacePath ?? null,
      input.repoPath ?? null,
      input.branch ?? null,
      input.baseBranch ?? null
    );

  appendEvent(context, {
    type: "workspace.created",
    summary: `workspace record created: ${id}`,
    projectId: input.projectId,
    taskId: input.taskId,
    attemptId: input.attemptId,
    workspaceId: id,
    payload: { status: input.status ?? "planned" }
  });

  return requireWorkspace(context, id);
}

function insertAgentSession(context: DbContext, input: CreateAgentSessionInput): AgentSessionRecord {
  const id = input.id ?? randomUUID();
  context.db
    .prepare(
      `INSERT INTO agent_sessions (
         id, project_id, task_id, attempt_id, provider_kind, role, status,
         transcript_path, prompt_path, surface_json_path, surface_markdown_path, final_response_path
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.projectId,
      input.taskId ?? null,
      input.attemptId ?? null,
      input.providerKind,
      input.role,
      input.status ?? "planned",
      input.transcriptPath ?? null,
      input.promptPath ?? null,
      input.surfaceJsonPath ?? null,
      input.surfaceMarkdownPath ?? null,
      input.finalResponsePath ?? null
    );

  appendEvent(context, {
    type: "agent.session_created",
    summary: `agent session record created: ${id}`,
    projectId: input.projectId,
    taskId: input.taskId,
    attemptId: input.attemptId,
    agentSessionId: id,
    payload: { status: input.status ?? "planned", providerKind: input.providerKind, role: input.role }
  });

  return requireAgentSession(context, id);
}

function insertWorkflowRun(context: DbContext, input: CreateWorkflowRunInput): WorkflowRunRecord {
  const id = input.id ?? randomUUID();
  context.db
    .prepare(
      `INSERT INTO workflow_runs (
         id, project_id, task_id, attempt_id, profile_id, status, external_id, handoff_kind
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.projectId,
      input.taskId,
      input.attemptId,
      input.profileId,
      input.status ?? "planned",
      input.externalId ?? null,
      input.handoffKind ?? null
    );

  appendEvent(context, {
    type: "workflow.record_created",
    summary: `workflow run record created: ${id}`,
    projectId: input.projectId,
    taskId: input.taskId,
    attemptId: input.attemptId,
    workflowRunId: id,
    payload: { status: input.status ?? "planned", profileId: input.profileId }
  });

  return requireWorkflowRun(context, id);
}

function insertPullRequest(context: DbContext, input: CreatePullRequestInput): PullRequestRecord {
  const id = input.id ?? randomUUID();
  context.db
    .prepare(
      `INSERT INTO pull_requests (
         id, project_id, task_id, attempt_id, provider_kind, external_id, url, status,
         head_branch, base_branch, head_sha, base_sha, title, body_artifact_path,
         review_status, review_summary, validation_run_id, merge_strategy, merged_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.projectId,
      input.taskId,
      input.attemptId ?? null,
      input.providerKind,
      input.externalId ?? null,
      input.url ?? null,
      input.status ?? "open",
      input.headBranch ?? null,
      input.baseBranch ?? null,
      input.headSha ?? null,
      input.baseSha ?? null,
      input.title ?? null,
      input.bodyArtifactPath ?? null,
      input.reviewStatus ?? "unknown",
      input.reviewSummary ?? null,
      input.validationRunId ?? null,
      input.mergeStrategy ?? null,
      input.mergedAt ?? null
    );

  appendEvent(context, {
    type: "pr.record_created",
    summary: `PR/MR record created: ${id}`,
    projectId: input.projectId,
    taskId: input.taskId,
    attemptId: input.attemptId,
    payload: {
      providerKind: input.providerKind,
      externalId: input.externalId,
      url: input.url,
      status: input.status ?? "open",
      headBranch: input.headBranch,
      baseBranch: input.baseBranch
    }
  });

  return requirePullRequest(context, id);
}

function requireProject(context: DbContext, id: string): ProjectRecord {
  const row = context.db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!row) {
    throw new Error(`project not found: ${id}`);
  }
  return mapProjectRow(row);
}

function requireTask(context: DbContext, id: string): TaskRecord {
  const row = context.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  if (!row) {
    throw new Error(`task not found: ${id}`);
  }
  return mapTaskRow(row);
}

function requireAttempt(context: DbContext, id: string): AttemptRecord {
  const row = context.db.prepare("SELECT * FROM attempts WHERE id = ?").get(id);
  if (!row) {
    throw new Error(`attempt not found: ${id}`);
  }
  return mapAttemptRow(row);
}

function requireExecutionPlan(context: DbContext, id: string): ExecutionPlanRecord {
  const row = context.db.prepare("SELECT * FROM execution_plans WHERE id = ?").get(id);
  if (!row) {
    throw new Error(`execution plan not found: ${id}`);
  }
  return mapExecutionPlanRow(row);
}

function requireHumanRequest(context: DbContext, id: string): HumanRequestRecord {
  const row = context.db.prepare("SELECT * FROM human_requests WHERE id = ?").get(id);
  if (!row) {
    throw new Error(`human request not found: ${id}`);
  }
  return mapHumanRequestRow(row);
}

function requireWorkspace(context: DbContext, id: string): WorkspaceRecord {
  const row = context.db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id);
  if (!row) {
    throw new Error(`workspace not found: ${id}`);
  }
  return mapWorkspaceRow(row);
}

function requireAgentSession(context: DbContext, id: string): AgentSessionRecord {
  const row = context.db.prepare("SELECT * FROM agent_sessions WHERE id = ?").get(id);
  if (!row) {
    throw new Error(`agent session not found: ${id}`);
  }
  return mapAgentSessionRow(row);
}

function requireWorkflowRun(context: DbContext, id: string): WorkflowRunRecord {
  const row = context.db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id);
  if (!row) {
    throw new Error(`workflow run not found: ${id}`);
  }
  return mapWorkflowRunRow(row);
}

function requirePullRequest(context: DbContext, id: string): PullRequestRecord {
  const row = context.db.prepare("SELECT * FROM pull_requests WHERE id = ?").get(id);
  if (!row) {
    throw new Error(`pull request not found: ${id}`);
  }
  return mapPullRequestRow(row);
}

function requireArtifact(context: DbContext, id: string): ArtifactRecord {
  const row = context.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id);
  if (!row) {
    throw new Error(`artifact not found: ${id}`);
  }
  return mapArtifactRow(row);
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
    .prepare("SELECT * FROM operations WHERE idempotency_key = ?")
    .get(idempotencyKey);
  if (!row) {
    throw new Error(`operation not found: ${idempotencyKey}`);
  }
  return mapOperationRow(row);
}

function findOperationByIdempotencyKey(context: DbContext, idempotencyKey: string): OperationRecord | undefined {
  const row = context.db
    .prepare("SELECT * FROM operations WHERE idempotency_key = ?")
    .get(idempotencyKey);
  return row ? mapOperationRow(row) : undefined;
}

function requireOperationById(context: DbContext, id: string): OperationRecord {
  const row = context.db
    .prepare("SELECT * FROM operations WHERE id = ?")
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
  const value = row as {
    id: string;
    name: string;
    repo_path: string | null;
    repo_url: string | null;
    git_provider_kind: string | null;
    git_provider_host: string | null;
    default_branch: string | null;
    pr_provider_kind: string | null;
    workspace_root: string | null;
    workflow_launcher: string | null;
    outer_agent_default_provider: string | null;
    inner_agent_default_provider: string | null;
    registration_status: string | null;
    registry_notes_json: string | null;
    state_version: number;
  };
  return {
    id: value.id,
    name: value.name,
    repoPath: value.repo_path ?? undefined,
    repoUrl: value.repo_url ?? undefined,
    gitProviderKind: value.git_provider_kind ?? undefined,
    gitProviderHost: value.git_provider_host ?? undefined,
    defaultBranch: value.default_branch ?? undefined,
    prProviderKind: value.pr_provider_kind ?? undefined,
    workspaceRoot: value.workspace_root ?? undefined,
    workflowLauncher: value.workflow_launcher ?? undefined,
    outerAgentDefaultProvider: value.outer_agent_default_provider ?? undefined,
    innerAgentDefaultProvider: value.inner_agent_default_provider ?? undefined,
    registrationStatus: value.registration_status ?? undefined,
    registryNotes: value.registry_notes_json ? JSON.parse(value.registry_notes_json) : undefined,
    stateVersion: value.state_version
  };
}

function mapTaskRow(row: unknown): TaskRecord {
  const value = row as {
    id: string;
    project_id: string;
    source_kind: string;
    title: string;
    description: string;
    autonomy: string;
    status: string;
    state_version: number;
  };
  return {
    id: value.id,
    projectId: value.project_id,
    sourceKind: value.source_kind,
    title: value.title,
    description: value.description,
    autonomy: value.autonomy,
    status: value.status,
    stateVersion: value.state_version
  };
}

function mapTaskListRow(row: unknown): TaskListRecord {
  const task = mapTaskRow(row);
  const value = row as {
    project_name: string;
    task_updated_at: string;
  };
  return {
    ...task,
    projectName: value.project_name,
    updatedAt: value.task_updated_at
  };
}

function mapAttemptRow(row: unknown): AttemptRecord {
  const value = row as {
    id: string;
    project_id: string;
    task_id: string;
    status: string;
    reason: string;
    state_version: number;
  };
  return {
    id: value.id,
    projectId: value.project_id,
    taskId: value.task_id,
    status: value.status,
    reason: value.reason,
    stateVersion: value.state_version
  };
}

function mapExecutionPlanRow(row: unknown): ExecutionPlanRecord {
  const value = row as {
    id: string;
    project_id: string;
    task_id: string;
    attempt_id: string | null;
    status: string;
    artifact_path: string | null;
    state_version: number;
  };
  return {
    id: value.id,
    projectId: value.project_id,
    taskId: value.task_id,
    attemptId: value.attempt_id ?? undefined,
    status: value.status,
    artifactPath: value.artifact_path ?? undefined,
    stateVersion: value.state_version
  };
}

function mapHumanRequestRow(row: unknown): HumanRequestRecord {
  const value = row as {
    id: string;
    project_id: string;
    task_id: string;
    attempt_id: string | null;
    pr_id: string | null;
    blocked_key: string;
    kind: string;
    status: string;
    question_artifact_path: string | null;
    answer_artifact_path: string | null;
    approval_pr_head_sha?: string | null;
    approval_pr_base_sha?: string | null;
    approval_validation_run_id?: string | null;
    approval_merge_strategy?: string | null;
    approval_valid?: number | null;
    approved_by?: string | null;
    approved_at?: string | null;
    state_version: number;
  };
  return {
    id: value.id,
    projectId: value.project_id,
    taskId: value.task_id,
    attemptId: value.attempt_id ?? undefined,
    prId: value.pr_id ?? undefined,
    blockedKey: value.blocked_key,
    kind: value.kind,
    status: value.status,
    questionArtifactPath: value.question_artifact_path ?? undefined,
    answerArtifactPath: value.answer_artifact_path ?? undefined,
    approvalPrHeadSha: value.approval_pr_head_sha ?? undefined,
    approvalPrBaseSha: value.approval_pr_base_sha ?? undefined,
    approvalValidationRunId: value.approval_validation_run_id ?? undefined,
    approvalMergeStrategy: value.approval_merge_strategy ?? undefined,
    approvalValid: value.approval_valid !== 0,
    approvedBy: value.approved_by ?? undefined,
    approvedAt: value.approved_at ?? undefined,
    stateVersion: value.state_version
  };
}

function mapWorkspaceRow(row: unknown): WorkspaceRecord {
  const value = row as {
    id: string;
    project_id: string;
    task_id: string;
    attempt_id: string;
    status: string;
    workspace_path: string | null;
    repo_path: string | null;
    branch: string | null;
    base_branch: string | null;
    state_version: number;
  };
  return {
    id: value.id,
    projectId: value.project_id,
    taskId: value.task_id,
    attemptId: value.attempt_id,
    status: value.status,
    workspacePath: value.workspace_path ?? undefined,
    repoPath: value.repo_path ?? undefined,
    branch: value.branch ?? undefined,
    baseBranch: value.base_branch ?? undefined,
    stateVersion: value.state_version
  };
}

function mapAgentSessionRow(row: unknown): AgentSessionRecord {
  const value = row as {
    id: string;
    project_id: string;
    task_id: string | null;
    attempt_id: string | null;
    provider_kind: string;
    role: string;
    status: string;
    transcript_path: string | null;
    prompt_path: string | null;
    surface_json_path: string | null;
    surface_markdown_path: string | null;
    final_response_path: string | null;
    state_version: number;
  };
  return {
    id: value.id,
    projectId: value.project_id,
    taskId: value.task_id ?? undefined,
    attemptId: value.attempt_id ?? undefined,
    providerKind: value.provider_kind,
    role: value.role,
    status: value.status,
    transcriptPath: value.transcript_path ?? undefined,
    promptPath: value.prompt_path ?? undefined,
    surfaceJsonPath: value.surface_json_path ?? undefined,
    surfaceMarkdownPath: value.surface_markdown_path ?? undefined,
    finalResponsePath: value.final_response_path ?? undefined,
    stateVersion: value.state_version
  };
}

function mapWorkflowRunRow(row: unknown): WorkflowRunRecord {
  const value = row as {
    id: string;
    project_id: string;
    task_id: string;
    attempt_id: string;
    profile_id: string;
    status: string;
    external_id: string | null;
    handoff_kind: string | null;
    state_version: number;
  };
  return {
    id: value.id,
    projectId: value.project_id,
    taskId: value.task_id,
    attemptId: value.attempt_id,
    profileId: value.profile_id,
    status: value.status,
    externalId: value.external_id ?? undefined,
    handoffKind: value.handoff_kind ?? undefined,
    stateVersion: value.state_version
  };
}

function mapPullRequestRow(row: unknown): PullRequestRecord {
  const value = row as {
    id: string;
    project_id: string;
    task_id: string;
    attempt_id: string | null;
    provider_kind: string;
    external_id: string | null;
    url: string | null;
    status: string;
    head_branch: string | null;
    base_branch: string | null;
    head_sha: string | null;
    base_sha: string | null;
    title: string | null;
    body_artifact_path: string | null;
    review_status: string | null;
    review_summary: string | null;
    validation_run_id: string | null;
    merge_strategy: string | null;
    merged_at: string | null;
    state_version: number;
  };
  return {
    id: value.id,
    projectId: value.project_id,
    taskId: value.task_id,
    attemptId: value.attempt_id ?? undefined,
    providerKind: value.provider_kind,
    externalId: value.external_id ?? undefined,
    url: value.url ?? undefined,
    status: value.status,
    headBranch: value.head_branch ?? undefined,
    baseBranch: value.base_branch ?? undefined,
    headSha: value.head_sha ?? undefined,
    baseSha: value.base_sha ?? undefined,
    title: value.title ?? undefined,
    bodyArtifactPath: value.body_artifact_path ?? undefined,
    reviewStatus: value.review_status ?? "unknown",
    reviewSummary: value.review_summary ?? undefined,
    validationRunId: value.validation_run_id ?? undefined,
    mergeStrategy: value.merge_strategy ?? undefined,
    mergedAt: value.merged_at ?? undefined,
    stateVersion: value.state_version
  };
}

function mapArtifactRow(row: unknown): ArtifactRecord {
  const value = row as {
    id: string;
    project_id: string | null;
    task_id: string | null;
    attempt_id: string | null;
    kind: string;
    owner: string;
    path: string;
  };
  return {
    id: value.id,
    projectId: value.project_id ?? undefined,
    taskId: value.task_id ?? undefined,
    attemptId: value.attempt_id ?? undefined,
    kind: value.kind,
    owner: value.owner,
    path: value.path
  };
}

function mapEventRow(row: unknown): EventRecord {
  const value = row as {
    id: number;
    type: string;
    summary: string;
    project_id: string | null;
    task_id: string | null;
    attempt_id: string | null;
    workspace_id: string | null;
    agent_session_id: string | null;
    workflow_run_id: string | null;
    pr_id: string | null;
    human_request_id: string | null;
    operation_id: string | null;
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
    attemptId: value.attempt_id ?? undefined,
    workspaceId: value.workspace_id ?? undefined,
    agentSessionId: value.agent_session_id ?? undefined,
    workflowRunId: value.workflow_run_id ?? undefined,
    prId: value.pr_id ?? undefined,
    humanRequestId: value.human_request_id ?? undefined,
    operationId: value.operation_id ?? undefined,
    severity: value.severity,
    payload: value.payload_json ? JSON.parse(value.payload_json) : undefined,
    artifactRefs: value.artifact_refs_json ? (JSON.parse(value.artifact_refs_json) as string[]) : [],
    createdAt: value.created_at
  };
}

function mapOperationRow(row: unknown): OperationRecord {
  const value = row as {
    id: string;
    idempotency_key: string;
    kind: string;
    status: string;
    project_id?: string | null;
    task_id?: string | null;
    attempt_id?: string | null;
    pr_id?: string | null;
    external_id?: string | null;
    failure_code?: string | null;
    last_observed_state?: string | null;
  };
  return {
    id: value.id,
    idempotencyKey: value.idempotency_key,
    kind: value.kind,
    status: value.status,
    projectId: value.project_id ?? undefined,
    taskId: value.task_id ?? undefined,
    attemptId: value.attempt_id ?? undefined,
    prId: value.pr_id ?? undefined,
    externalId: value.external_id ?? undefined,
    failureCode: value.failure_code ?? undefined,
    lastObservedState: value.last_observed_state ? JSON.parse(value.last_observed_state) : undefined
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

function isTerminalOperationStatus(status: string): boolean {
  return status === "succeeded" || status === "reconciled" || status === "canceled";
}
