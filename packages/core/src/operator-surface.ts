import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, normalize, relative, resolve, sep } from "node:path";
import {
  ActiveResourceConflictError,
  appendEvent,
  createArtifact,
  createTask,
  getActiveWorkspaceByAttempt,
  getHumanRequest,
  getLatestAttemptByTask,
  getLatestExecutionPlanByTask,
  getLatestPullRequestByTask,
  getProject,
  getTask,
  listAgentSessionsByTask,
  listHumanRequestsByTask,
  listPullRequestsByTask,
  listTaskEvents,
  listTasksForOperator,
  listWorkflowRunsByTask,
  updateHumanRequest,
  updateTaskStatus,
  withTransaction,
  type AgentSessionRecord,
  type AttemptRecord,
  type DbContext,
  type EventRecord,
  type ExecutionPlanRecord,
  type HumanRequestRecord,
  type ProjectRecord,
  type PullRequestRecord,
  type TaskListRecord,
  type TaskRecord,
  type WorkflowRunRecord,
  type WorkspaceRecord
} from "@coordinator/db";
import { buildTaskSurfaceFromDb, type SurfaceEnvelope } from "./surface.js";
import { assertArtifactRelativePath } from "./workspace-manager.js";

export type OperatorTaskListItem = TaskListRecord;

export type OperatorTaskDetail = {
  task: TaskRecord;
  project: ProjectRecord;
  attempt?: AttemptRecord;
  executionPlan?: ExecutionPlanRecord;
  workspace?: WorkspaceRecord;
  workflowRuns: WorkflowRunRecord[];
  agentSessions: AgentSessionRecord[];
  pullRequests: PullRequestRecord[];
  latestPullRequest?: PullRequestRecord;
  humanRequests: HumanRequestRecord[];
  events: EventRecord[];
  surface: SurfaceEnvelope;
  currentBlocker: string;
};

export type CreateManualTaskInput = {
  projectId: string;
  title: string;
  description?: string;
  autonomy?: string;
};

export type RecordHumanAnswerInput = {
  humanRequestId: string;
  expectedStateVersion: number;
  answer: string;
  answeredBy?: string;
};

export type RecordHumanAnswerResult = {
  humanRequest: HumanRequestRecord;
  artifactPath: string;
};

export type OperatorTaskControlAction = "pause" | "resume" | "cancel" | "retry";

export type ControlTaskInput = {
  taskId: string;
  expectedStateVersion: number;
  action: OperatorTaskControlAction;
  reason?: string;
  actor?: string;
  now?: Date;
  retryDelayMs?: number;
};

export type ControlTaskResult = {
  task: TaskRecord;
  action: OperatorTaskControlAction;
  previousStatus: string;
  nextStatus: string;
  dueAt?: string;
};

export class OperatorSurfaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorSurfaceError";
  }
}

export function listOperatorTasks(context: DbContext, limit = 50): OperatorTaskListItem[] {
  return listTasksForOperator(context, { limit });
}

export function createManualTask(context: DbContext, input: CreateManualTaskInput): TaskRecord {
  const title = normalizeRequiredText(input.title, "title", 200);
  const description = normalizeOptionalText(input.description, 20_000);
  const autonomy = normalizeAutonomy(input.autonomy);
  const project = getProject(context, input.projectId);
  if (!project) {
    throw new OperatorSurfaceError(`project not found: ${input.projectId}`);
  }
  return createTask(context, {
    projectId: project.id,
    title,
    description,
    autonomy,
    sourceKind: "manual"
  });
}

export function controlTaskRuntime(context: DbContext, input: ControlTaskInput): ControlTaskResult {
  const task = getTask(context, input.taskId);
  if (!task) {
    throw new OperatorSurfaceError(`task not found: ${input.taskId}`);
  }
  if (task.stateVersion !== input.expectedStateVersion) {
    throw new ActiveResourceConflictError(`task ${task.id} state_version mismatch`);
  }
  const action = normalizeTaskControlAction(input.action);
  const actor = normalizeRequiredText(input.actor ?? "operator", "actor", 120);
  const reason = normalizeOptionalText(input.reason, 2_000) || defaultTaskControlReason(action);
  const now = input.now ?? new Date();
  const nextStatus = deriveTaskControlNextStatus(task, action);
  const dueAt =
    action === "resume" || action === "retry"
      ? new Date(now.getTime() + Math.max(0, input.retryDelayMs ?? 0)).toISOString()
      : undefined;

  return withTransaction(context, () => {
    const updated = updateTaskStatus(context, task.id, task.stateVersion, nextStatus);
    appendEvent(context, {
      type: taskControlEventType(action),
      summary: `operator ${action} task: ${task.id}`,
      projectId: task.projectId,
      taskId: task.id,
      severity: action === "cancel" ? "warn" : "info",
      payload: {
        action,
        actor,
        reason,
        previousStatus: task.status,
        nextStatus,
        expectedStateVersion: input.expectedStateVersion,
        dueAt
      }
    });
    return {
      task: updated,
      action,
      previousStatus: task.status,
      nextStatus,
      dueAt
    };
  });
}

export function getOperatorTaskDetail(context: DbContext, taskId: string): OperatorTaskDetail {
  const task = getTask(context, taskId);
  if (!task) {
    throw new OperatorSurfaceError(`task not found: ${taskId}`);
  }
  const project = getProject(context, task.projectId);
  if (!project) {
    throw new OperatorSurfaceError(`project not found: ${task.projectId}`);
  }
  const attempt = getLatestAttemptByTask(context, task.id);
  const workspace = attempt ? getActiveWorkspaceByAttempt(context, attempt.id) : undefined;
  const workflowRuns = listWorkflowRunsByTask(context, task.id, 5);
  const pullRequests = listPullRequestsByTask(context, task.id, 5);
  const humanRequests = listHumanRequestsByTask(context, task.id, 10);
  const surface = buildTaskSurfaceFromDb(context, task.id);

  return {
    task,
    project,
    attempt,
    executionPlan: getLatestExecutionPlanByTask(context, task.id),
    workspace,
    workflowRuns,
    agentSessions: listAgentSessionsByTask(context, task.id, 5),
    pullRequests,
    latestPullRequest: getLatestPullRequestByTask(context, task.id),
    humanRequests,
    events: listTaskEvents(context, task.id),
    surface,
    currentBlocker: deriveCurrentBlocker(task, humanRequests, pullRequests[0])
  };
}

export function recordHumanAnswerRuntime(
  context: DbContext,
  input: RecordHumanAnswerInput
): RecordHumanAnswerResult {
  const request = getHumanRequest(context, input.humanRequestId);
  if (!request) {
    throw new OperatorSurfaceError(`human request not found: ${input.humanRequestId}`);
  }
  if (request.status !== "pending") {
    throw new ActiveResourceConflictError(`human request is not pending: ${request.id}:${request.status}`);
  }
  if (request.stateVersion !== input.expectedStateVersion) {
    throw new ActiveResourceConflictError(`human request ${request.id} state_version mismatch`);
  }
  const answer = normalizeRequiredText(input.answer, "answer", 200_000);
  const answeredBy = normalizeRequiredText(input.answeredBy ?? "web-operator", "answeredBy", 120);
  const surface = buildTaskSurfaceFromDb(context, request.taskId);
  const artifact = writeHumanAnswerArtifact(surface, request, answer, answeredBy);

  try {
    return withTransaction(context, () => {
      createArtifact(context, {
        projectId: request.projectId,
        taskId: request.taskId,
        attemptId: request.attemptId,
        kind: "human-answer",
        owner: answeredBy,
        path: artifact.relativePath
      });
      const updated = updateHumanRequest(context, {
        humanRequestId: request.id,
        expectedStateVersion: request.stateVersion,
        status: "answered",
        answerArtifactPath: artifact.relativePath
      });
      const task = getTask(context, request.taskId);
      if (task && task.status === "waiting_human") {
        // answer 本身只唤醒任务，不替 agent 消化回答或直接推进业务状态。
        updateTaskStatus(context, task.id, task.stateVersion, "human_answered");
      }
      appendEvent(context, {
        type: "human.answer_received",
        summary: `human answer received: ${request.id}`,
        projectId: request.projectId,
        taskId: request.taskId,
        attemptId: request.attemptId,
        prId: request.prId,
        humanRequestId: request.id,
        payload: { answeredBy, artifactPath: artifact.relativePath },
        artifactRefs: [artifact.relativePath]
      });
      return { humanRequest: updated, artifactPath: artifact.relativePath };
    });
  } catch (error) {
    // 先写 artifact 是为了避免 DB 指向缺失文件；若 CAS/事务失败，立即清理本次唯一文件，避免污染 artifact root。
    rmSync(artifact.absolutePath, { force: true });
    throw error;
  }
}

function writeHumanAnswerArtifact(
  surface: SurfaceEnvelope,
  request: HumanRequestRecord,
  answer: string,
  answeredBy: string
): { relativePath: string; absolutePath: string } {
  const relativePath = assertArtifactRelativePath(`human-answers/${request.id}-v${request.stateVersion}-${randomUUID()}.md`);
  const root = resolve(surface.json.artifact_root);
  mkdirSync(root, { recursive: true });
  const rootReal = realpathSync(root);
  const absolutePath = resolve(rootReal, relativePath);
  if (!isPathInside(rootReal, dirname(absolutePath))) {
    throw new OperatorSurfaceError(`human answer artifact path 逃逸 root：${relativePath}`);
  }
  mkdirSync(dirname(absolutePath), { recursive: true });
  const parentReal = realpathSync(dirname(absolutePath));
  if (!isPathInside(rootReal, parentReal)) {
    throw new OperatorSurfaceError(`human answer artifact parent 逃逸 root：${relativePath}`);
  }
  writeFileSync(
    absolutePath,
    [
      `# Human Answer`,
      ``,
      `- request_id: ${request.id}`,
      `- answered_by: ${answeredBy}`,
      `- answered_at: ${new Date().toISOString()}`,
      ``,
      answer,
      ``
    ].join("\n"),
    "utf8"
  );
  return { relativePath, absolutePath };
}

function deriveCurrentBlocker(
  task: TaskRecord,
  humanRequests: HumanRequestRecord[],
  latestPullRequest: PullRequestRecord | undefined
): string {
  const pendingHuman = humanRequests.find((request) => request.status === "pending");
  if (pendingHuman) {
    return `waiting human: ${pendingHuman.kind}`;
  }
  if (task.status === "merge_waiting") {
    const approval = humanRequests.find((request) => request.kind === "merge_approval");
    return approval ? `waiting merge approval: ${approval.status}` : "waiting merge approval";
  }
  if (latestPullRequest && latestPullRequest.status !== "merged") {
    return `waiting PR/MR: ${latestPullRequest.status}`;
  }
  return task.status;
}

function deriveTaskControlNextStatus(task: TaskRecord, action: OperatorTaskControlAction): string {
  if (action === "resume") {
    if (task.status !== "paused") {
      throw new ActiveResourceConflictError(`task is not paused: ${task.id}:${task.status}`);
    }
    return "resuming";
  }
  if (isTerminalTaskStatus(task.status)) {
    throw new ActiveResourceConflictError(`task is terminal: ${task.id}:${task.status}`);
  }
  if (action === "pause") {
    if (task.status === "paused") {
      throw new ActiveResourceConflictError(`task is already paused: ${task.id}`);
    }
    return "paused";
  }
  if (action === "cancel") {
    return "canceled";
  }
  if (action === "retry") {
    if (task.status === "paused") {
      throw new ActiveResourceConflictError(`paused task must be resumed, not retried: ${task.id}`);
    }
    if (isHumanOrApprovalWaitingStatus(task.status)) {
      throw new ActiveResourceConflictError(`task is waiting for human/operator gate: ${task.id}:${task.status}`);
    }
    return "resuming";
  }
  return assertNeverTaskControl(action);
}

function normalizeTaskControlAction(value: string): OperatorTaskControlAction {
  if (value === "pause" || value === "resume" || value === "cancel" || value === "retry") {
    return value;
  }
  throw new OperatorSurfaceError(`不支持的 task control action：${value}`);
}

function taskControlEventType(action: OperatorTaskControlAction): string {
  return action === "pause"
    ? "operator.task_paused"
    : action === "resume"
      ? "operator.task_resumed"
      : action === "cancel"
        ? "operator.task_canceled"
        : "operator.task_retry_requested";
}

function defaultTaskControlReason(action: OperatorTaskControlAction): string {
  return action === "pause"
    ? "operator-paused"
    : action === "resume"
      ? "operator-resumed"
      : action === "cancel"
        ? "operator-canceled"
        : "operator-retry-requested";
}

function isTerminalTaskStatus(status: string): boolean {
  return status === "completed" || status === "handoff" || status === "canceled" || status === "failed";
}

function isHumanOrApprovalWaitingStatus(status: string): boolean {
  return status === "waiting_human" || status === "waiting_review" || status === "waiting_merge_approval" || status === "merge_waiting";
}

function assertNeverTaskControl(value: never): never {
  throw new OperatorSurfaceError(`未知 task control action：${String(value)}`);
}

function normalizeAutonomy(value: string | undefined): string {
  const normalized = value?.trim() || "balanced";
  if (normalized === "conservative" || normalized === "balanced" || normalized === "aggressive") {
    return normalized;
  }
  throw new OperatorSurfaceError(`不支持的 autonomy：${value}`);
}

function normalizeRequiredText(value: string, fieldName: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new OperatorSurfaceError(`${fieldName} 不能为空`);
  }
  if (normalized.length > maxLength) {
    throw new OperatorSurfaceError(`${fieldName} 过长`);
  }
  return normalized;
}

function normalizeOptionalText(value: string | undefined, maxLength: number): string {
  if (value === undefined) {
    return "";
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new OperatorSurfaceError(`description 过长`);
  }
  return normalized;
}

function isPathInside(root: string, target: string): boolean {
  const normalizedRoot = normalize(root);
  const normalizedTarget = normalize(target);
  const rel = relative(normalizedRoot, normalizedTarget);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel) && !rel.split(sep).includes(".."));
}
