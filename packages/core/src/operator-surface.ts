import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, normalize, relative, resolve, sep } from "node:path";
import {
  ActiveResourceConflictError,
  appendEvent,
  createArtifact,
  createTaskAttachment,
  createTask,
  getHumanRequest,
  getLatestAttemptByTask,
  getLatestExecutionPlanByTask,
  getLatestPullRequestByTask,
  getOperatorWorkspaceByAttempt,
  getProject,
  getTask,
  listAgentSessionsByTask,
  listHumanRequestsByTask,
  listOperationsByTask,
  listPullRequestsByTask,
  listTaskAttachmentsByTask,
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
  type OperationRecord,
  type ProjectRecord,
  type PullRequestRecord,
  type TaskAttachmentRecord,
  type TaskListRecord,
  type TaskRecord,
  type WorkflowRunRecord,
  type WorkspaceRecord
} from "@coordinator/db";
import {
  buildAgentActivitySummary,
  extractAgentActivitySummary,
  type AgentActivitySummary
} from "./agent-activity.js";
import { buildTaskSurfaceFromDb, type SurfaceEnvelope } from "./surface.js";
import { assertArtifactRelativePath } from "./workspace-manager.js";
import { deriveWorkflowRuntimeObservationForRun } from "./workflow-runtime-observation.js";
import type { WorkflowRuntimeObservation } from "@coordinator/shared";

export type OperatorTaskListItem = TaskListRecord;

export type OperatorAgentSessionSummary = AgentSessionRecord & {
  activity?: AgentActivitySummary;
};

export type OperatorTaskDetail = {
  task: TaskRecord;
  project: ProjectRecord;
  attempt?: AttemptRecord;
  executionPlan?: ExecutionPlanRecord;
  workspace?: WorkspaceRecord;
  workflowRuns: WorkflowRunRecord[];
  workflowObservation?: WorkflowRuntimeObservation;
  agentSessions: OperatorAgentSessionSummary[];
  pullRequests: PullRequestRecord[];
  latestPullRequest?: PullRequestRecord;
  humanRequests: HumanRequestRecord[];
  attachments: TaskAttachmentRecord[];
  taskNotes: OperatorTaskNoteRef[];
  events: EventRecord[];
  surface: SurfaceEnvelope;
  currentBlocker: string;
  diagnosis: OperatorTaskDiagnosis;
};

export type OperatorTaskDiagnosis = {
  currentBlocker: string;
  operatorAttention: {
    required: boolean;
    reasons: string[];
  };
  retryBudget: {
    scheduledCount: number;
    latestDueAt?: string;
    exhausted: boolean;
    lastReason?: string;
  };
  operationLedger: OperatorOperationSummary[];
  recoveryTimeline: OperatorRecoverySummary[];
  providerProtocolInspections: OperatorInspectionSummary[];
};

export type OperatorOperationSummary = {
  id: string;
  kind: string;
  status: string;
  failureCode?: string;
  externalId?: string;
  lastDecision?: string;
  lastReasonCode?: string;
  lastError?: string;
  lastObservedSummary?: string;
};

export type OperatorRecoverySummary = {
  eventId: number;
  resourceKind?: string;
  resourceId?: string;
  attemptId?: string;
  operationId?: string;
  decision?: string;
  reasonCode?: string;
  observedSummary?: string;
  nextAction?: string;
  retryDueAt?: string;
  operatorAttentionRequired: boolean;
  artifactRefs: string[];
  severity: string;
  createdAt: string;
};

export type OperatorInspectionSummary = {
  eventId: number;
  type: string;
  summary: string;
  resource?: string;
  operationId?: string;
  artifactRefs: string[];
  severity: string;
  createdAt: string;
};

export type OperatorTaskNoteRef = {
  eventId: number;
  artifactPath: string;
  summary: string;
  actor?: string;
  createdAt: string;
};

export type OperatorExecutionSummary = {
  task: {
    id: string;
    title: string;
    status: string;
    autonomy: string;
    stateVersion: number;
  };
  project: {
    id: string;
    name: string;
    defaultBranch?: string;
  };
  attempt?: {
    id: string;
    status: string;
    reason: string;
  };
  workspace?: {
    id: string;
    status: string;
    branch?: string;
    path?: string;
  };
  agentSessions: Array<{
    id: string;
    role: string;
    providerKind: string;
    status: string;
    finalResponsePath?: string;
    activity?: AgentActivitySummary;
  }>;
  coordinatorTools: Array<{
    eventId: number;
    toolName?: string;
    status?: string;
    summary: string;
    artifactRefs: string[];
    extraArtifact: boolean;
  }>;
  workflow?: {
    id: string;
    profileId: string;
    selectionSource?: string;
    requestedProfileId?: string;
    requestedProfileAlias?: string;
    status: string;
    externalId?: string;
    handoffKind?: string;
    observation?: WorkflowRuntimeObservation;
  };
  artifacts: Array<{
    path: string;
    kind?: string;
    sourceEventType?: string;
    extra: boolean;
  }>;
  attachments: Array<{
    id: string;
    safeFilename: string;
    mimeType: string;
    sizeBytes: number;
    artifactPath: string;
    retentionKind: string;
  }>;
  taskNotes: OperatorTaskNoteRef[];
  nextStep: {
    recommended: string;
    currentBlocker: string;
    availableTools: string[];
  };
};

export type CreateManualTaskInput = {
  projectId: string;
  title: string;
  description?: string;
  autonomy?: string;
  requestedWorkflowProfile?: string;
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

export type UploadTaskAttachmentInput = {
  taskId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentBase64: string;
  actor: string;
  retentionKind?: string;
};

export type UploadTaskAttachmentResult = {
  attachment: TaskAttachmentRecord;
  artifactPath: string;
};

export type AddTaskNoteInput = {
  taskId: string;
  note: string;
  actor: string;
};

export type AddTaskNoteResult = {
  artifactPath: string;
  event: EventRecord;
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

export const MAX_TASK_ATTACHMENT_BYTES = 2 * 1024 * 1024;

const MAX_TASK_ATTACHMENT_BASE64_LENGTH = Math.ceil((MAX_TASK_ATTACHMENT_BYTES * 4) / 3) + 8;
const ATTACHMENT_RETENTION_KIND = "task-local";
const ATTACHMENT_MIME_EXTENSIONS = new Map<string, string[]>([
  ["image/png", [".png"]],
  ["image/jpeg", [".jpg", ".jpeg"]],
  ["image/webp", [".webp"]],
  ["image/gif", [".gif"]],
  ["text/plain", [".txt", ".log"]],
  ["text/markdown", [".md", ".markdown"]],
  ["application/json", [".json"]],
  ["application/pdf", [".pdf"]]
]);

export function listOperatorTasks(context: DbContext, limit = 50): OperatorTaskListItem[] {
  return listTasksForOperator(context, { limit });
}

export function createManualTask(context: DbContext, input: CreateManualTaskInput): TaskRecord {
  const title = normalizeRequiredText(input.title, "title", 200);
  const description = normalizeOptionalText(input.description, 20_000);
  const autonomy = normalizeAutonomy(input.autonomy);
  const requestedWorkflowProfile = normalizeWorkflowProfile(input.requestedWorkflowProfile);
  const project = getProject(context, input.projectId);
  if (!project) {
    throw new OperatorSurfaceError(`project not found: ${input.projectId}`);
  }
  return createTask(context, {
    projectId: project.id,
    title,
    description,
    autonomy,
    requestedWorkflowProfile,
    sourceKind: "manual"
  });
}

export function uploadTaskAttachmentRuntime(
  context: DbContext,
  input: UploadTaskAttachmentInput
): UploadTaskAttachmentResult {
  const task = getTask(context, input.taskId);
  if (!task) {
    throw new OperatorSurfaceError(`task not found: ${input.taskId}`);
  }
  const project = getProject(context, task.projectId);
  if (!project) {
    throw new OperatorSurfaceError(`project not found: ${task.projectId}`);
  }
  const actor = normalizeRequiredText(input.actor, "actor", 120);
  const mimeType = normalizeAttachmentMimeType(input.mimeType);
  const safeName = normalizeAttachmentFilename(input.fileName, mimeType);
  const payload = decodeAttachmentPayload(input.contentBase64);
  if (input.sizeBytes !== payload.byteLength) {
    throw new OperatorSurfaceError(`attachment size mismatch`);
  }
  const attempt = getLatestAttemptByTask(context, task.id);
  const surface = buildTaskSurfaceFromDb(context, task.id);
  const attachmentId = randomUUID();
  const artifact = writeAttachmentArtifact(surface, attachmentId, safeName, payload);

  try {
    return withTransaction(context, () => {
      const artifactRecord = createArtifact(context, {
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt?.id,
        kind: "task-attachment",
        owner: actor,
        path: artifact.relativePath
      });
      const attachment = createTaskAttachment(context, {
        id: attachmentId,
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt?.id,
        artifactId: artifactRecord.id,
        artifactPath: artifact.relativePath,
        originalFilename: input.fileName,
        safeFilename: safeName,
        mimeType,
        sizeBytes: payload.byteLength,
        actor,
        retentionKind: ATTACHMENT_RETENTION_KIND
      });
      appendEvent(context, {
        type: "task.attachment_uploaded",
        summary: `task attachment uploaded: ${safeName}`,
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt?.id,
        payload: {
          attachmentId: attachment.id,
          safeFilename: attachment.safeFilename,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          actor,
          retentionKind: attachment.retentionKind
        },
        artifactRefs: [attachment.artifactPath]
      });
      return { attachment, artifactPath: attachment.artifactPath };
    });
  } catch (error) {
    // 文件先落盘是为了让 DB 只指向已存在 artifact；事务失败时删除本次唯一文件避免孤儿 artifact。
    rmSync(artifact.absolutePath, { force: true });
    throw error;
  }
}

export function addTaskNoteRuntime(context: DbContext, input: AddTaskNoteInput): AddTaskNoteResult {
  const task = getTask(context, input.taskId);
  if (!task) {
    throw new OperatorSurfaceError(`task not found: ${input.taskId}`);
  }
  const project = getProject(context, task.projectId);
  if (!project) {
    throw new OperatorSurfaceError(`project not found: ${task.projectId}`);
  }
  const actor = normalizeRequiredText(input.actor, "actor", 120);
  const note = normalizeRequiredText(input.note, "note", 50_000);
  const attempt = getLatestAttemptByTask(context, task.id);
  const surface = buildTaskSurfaceFromDb(context, task.id);
  const artifact = writeTaskNoteArtifact(surface, task.id, note, actor);

  try {
    return withTransaction(context, () => {
      createArtifact(context, {
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt?.id,
        kind: "task-note",
        owner: actor,
        path: artifact.relativePath
      });
      const event = appendEvent(context, {
        type: "task.note_added",
        summary: `task note added: ${task.id}`,
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt?.id,
        payload: {
          actor,
          artifactPath: artifact.relativePath,
          // note 正文只进入 artifact，event 保留短摘要方便 operator timeline 扫描。
          excerpt: truncateText(note.replace(/\s+/g, " "), 180)
        },
        artifactRefs: [artifact.relativePath]
      });
      return { artifactPath: artifact.relativePath, event };
    });
  } catch (error) {
    rmSync(artifact.absolutePath, { force: true });
    throw error;
  }
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
  const workspace = attempt ? getOperatorWorkspaceByAttempt(context, attempt.id) : undefined;
  const workflowRuns = listWorkflowRunsByTask(context, task.id, 5);
  const pullRequests = listPullRequestsByTask(context, task.id, 5);
  const humanRequests = listHumanRequestsByTask(context, task.id, 10);
  const attachments = listTaskAttachmentsByTask(context, task.id, 20);
  const events = listTaskEvents(context, task.id);
  const taskNotes = summarizeTaskNoteRefs(events);
  const latestPullRequest = getLatestPullRequestByTask(context, task.id);
  const agentSessions = enrichAgentSessionsWithActivity(listAgentSessionsByTask(context, task.id, 5), events);
  const currentWorkflowRun = findCurrentWorkflowRun(workflowRuns, attempt);
  const workflowObservation = currentWorkflowRun
    ? deriveWorkflowRuntimeObservationForRun(currentWorkflowRun, events)
    : undefined;
  const currentPullRequest = findCurrentPullRequest(pullRequests, attempt);
  const currentActiveAgentSession = findCurrentAgentSession(agentSessions, attempt, isActiveAgentSessionStatus);
  const currentAttentionAgentSession = findCurrentAgentSession(agentSessions, attempt, isCurrentAgentAttentionStatus);
  const currentBlocker = deriveCurrentBlocker({
    task,
    workspace,
    workflowRun: currentWorkflowRun,
    agentSession: currentActiveAgentSession,
    humanRequests,
    latestPullRequest: currentPullRequest
  });
  const surface = buildTaskSurfaceFromDb(context, task.id);
  const operations = listOperationsByTask(context, task.id, 10);
  const diagnosis = buildOperatorTaskDiagnosis({
    currentBlocker,
    attempt,
    workspace,
    currentWorkflowRun,
    latestPullRequest: currentPullRequest,
    currentAgentSession: currentAttentionAgentSession,
    events,
    operations,
    humanRequests
  });

  return {
    task,
    project,
    attempt,
    executionPlan: getLatestExecutionPlanByTask(context, task.id),
    workspace,
    workflowRuns,
    workflowObservation,
    agentSessions,
    pullRequests,
    latestPullRequest,
    humanRequests,
    attachments,
    taskNotes,
    events,
    surface,
    currentBlocker,
    diagnosis
  };
}

export function getOperatorExecutionSummary(context: DbContext, taskId: string): OperatorExecutionSummary {
  const detail = getOperatorTaskDetail(context, taskId);
  const currentWorkflowRun = findCurrentWorkflowRun(detail.workflowRuns, detail.attempt);
  const toolEvents = detail.events.filter((event) =>
    event.type === "agent_tool_call" ||
    event.type === "daemon.agent_tool_executed" ||
    event.type === "daemon.agent_artifact_written" ||
    event.type === "daemon.agent_extra_artifact_written"
  );
  return {
    task: {
      id: detail.task.id,
      title: detail.task.title,
      status: detail.task.status,
      autonomy: detail.task.autonomy,
      stateVersion: detail.task.stateVersion
    },
    project: {
      id: detail.project.id,
      name: detail.project.name,
      defaultBranch: detail.project.defaultBranch
    },
    attempt: detail.attempt
      ? {
          id: detail.attempt.id,
          status: detail.attempt.status,
          reason: detail.attempt.reason
        }
      : undefined,
    workspace: detail.workspace
      ? {
          id: detail.workspace.id,
          status: detail.workspace.status,
          branch: detail.workspace.branch,
          path: detail.workspace.workspacePath
        }
      : undefined,
    agentSessions: detail.agentSessions.map((session) => ({
      id: session.id,
      role: session.role,
      providerKind: session.providerKind,
      status: session.status,
      finalResponsePath: session.finalResponsePath,
      activity: session.activity
    })),
    coordinatorTools: toolEvents.slice(-12).map(mapCoordinatorToolSummary),
    workflow: currentWorkflowRun
      ? {
          id: currentWorkflowRun.id,
          profileId: currentWorkflowRun.profileId,
          selectionSource: currentWorkflowRun.selectionSource,
          requestedProfileId: currentWorkflowRun.requestedProfileId,
          requestedProfileAlias: currentWorkflowRun.requestedProfileAlias,
          status: currentWorkflowRun.status,
          externalId: currentWorkflowRun.externalId,
          handoffKind: currentWorkflowRun.handoffKind,
          observation: detail.workflowObservation
        }
      : undefined,
    artifacts: summarizeArtifactRefs(detail.events),
    attachments: detail.attachments.map((attachment) => ({
      id: attachment.id,
      safeFilename: attachment.safeFilename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      artifactPath: attachment.artifactPath,
      retentionKind: attachment.retentionKind
    })),
    taskNotes: detail.taskNotes,
    nextStep: {
      recommended: detail.surface.json.recommended_next_step,
      currentBlocker: detail.currentBlocker,
      availableTools: detail.surface.json.available_tools.map((tool) => tool.name)
    }
  };
}

function enrichAgentSessionsWithActivity(
  sessions: AgentSessionRecord[],
  events: EventRecord[]
): OperatorAgentSessionSummary[] {
  return sessions.map((session) => ({
    ...session,
    activity: findLatestAgentActivity(session, events)
  }));
}

function findLatestAgentActivity(session: AgentSessionRecord, events: EventRecord[]): AgentActivitySummary {
  for (const event of [...events].reverse()) {
    if (event.agentSessionId !== session.id) {
      continue;
    }
    const activity = extractAgentActivitySummary(event.payload);
    if (activity) {
      return activity;
    }
  }
  // 没有 normalized event 时只用 session 机器事实做 fallback，避免读取 raw transcript 扩大 operator summary。
  return buildAgentActivitySummary({
    state: mapAgentSessionStatusToActivityState(session.status),
    providerId: session.providerKind,
    transcriptPath: session.transcriptPath,
    finalResponsePath: session.finalResponsePath,
    fallbackTimestamp: session.updatedAt,
    normalizedEvents: []
  });
}

function mapAgentSessionStatusToActivityState(status: string): AgentActivitySummary["state"] {
  if (status === "starting") return "starting";
  if (status === "running") return "running";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "stalled") return "stalled";
  return "unknown";
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

function writeAttachmentArtifact(
  surface: SurfaceEnvelope,
  attachmentId: string,
  safeName: string,
  payload: Buffer
): { relativePath: string; absolutePath: string } {
  const relativePath = assertArtifactRelativePath(`attachments/${attachmentId}/${safeName}`);
  const absolutePath = resolveArtifactPath(surface, relativePath, "attachment artifact");
  writeFileSync(absolutePath, payload);
  return { relativePath, absolutePath };
}

function writeTaskNoteArtifact(
  surface: SurfaceEnvelope,
  taskId: string,
  note: string,
  actor: string
): { relativePath: string; absolutePath: string } {
  const relativePath = assertArtifactRelativePath(`task-notes/${randomUUID()}.md`);
  const absolutePath = resolveArtifactPath(surface, relativePath, "task note artifact");
  writeFileSync(
    absolutePath,
    [
      `# Task Note`,
      ``,
      `- task_id: ${taskId}`,
      `- actor: ${actor}`,
      `- created_at: ${new Date().toISOString()}`,
      ``,
      note,
      ``
    ].join("\n"),
    "utf8"
  );
  return { relativePath, absolutePath };
}

function resolveArtifactPath(surface: SurfaceEnvelope, relativePath: string, label: string): string {
  const root = resolve(surface.json.artifact_root);
  mkdirSync(root, { recursive: true });
  const rootReal = realpathSync(root);
  const absolutePath = resolve(rootReal, relativePath);
  if (!isPathInside(rootReal, dirname(absolutePath))) {
    throw new OperatorSurfaceError(`${label} 逃逸 root：${relativePath}`);
  }
  mkdirSync(dirname(absolutePath), { recursive: true });
  const parentReal = realpathSync(dirname(absolutePath));
  if (!isPathInside(rootReal, parentReal)) {
    throw new OperatorSurfaceError(`${label} parent 逃逸 root：${relativePath}`);
  }
  return absolutePath;
}

function decodeAttachmentPayload(contentBase64: string): Buffer {
  const normalized = normalizeRequiredText(contentBase64, "contentBase64", MAX_TASK_ATTACHMENT_BASE64_LENGTH);
  if (normalized.includes(",")) {
    throw new OperatorSurfaceError("contentBase64 必须是不含 data URL 前缀的 base64");
  }
  if (normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new OperatorSurfaceError("contentBase64 不是有效 base64");
  }
  const payload = Buffer.from(normalized, "base64");
  if (payload.length === 0) {
    throw new OperatorSurfaceError("attachment payload 不能为空");
  }
  if (payload.toString("base64") !== normalized) {
    throw new OperatorSurfaceError("contentBase64 不是规范 base64");
  }
  if (payload.length > MAX_TASK_ATTACHMENT_BYTES) {
    throw new OperatorSurfaceError(`attachment payload 超过 ${MAX_TASK_ATTACHMENT_BYTES} bytes`);
  }
  return payload;
}

function normalizeAttachmentMimeType(value: string): string {
  const normalized = normalizeRequiredText(value, "mimeType", 120).toLowerCase();
  if (!ATTACHMENT_MIME_EXTENSIONS.has(normalized)) {
    throw new OperatorSurfaceError(`不支持的 attachment MIME type：${value}`);
  }
  return normalized;
}

function normalizeAttachmentFilename(value: string, mimeType: string): string {
  const original = normalizeRequiredText(value, "fileName", 255);
  if (original.includes("/") || original.includes("\\") || original.includes("..")) {
    throw new OperatorSurfaceError(`attachment fileName 包含非法路径片段`);
  }
  const extension = extname(original).toLowerCase();
  const allowedExtensions = ATTACHMENT_MIME_EXTENSIONS.get(mimeType) ?? [];
  if (!extension || !allowedExtensions.includes(extension)) {
    throw new OperatorSurfaceError(`attachment extension 与 MIME type 不匹配`);
  }
  const stem = original.slice(0, -extension.length);
  const safeStem = stem
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!safeStem) {
    // 空 safe stem 说明文件名无法稳定映射到 operator surface，拒绝比静默折叠更可追踪。
    throw new OperatorSurfaceError(`attachment safe filename 为空`);
  }
  const safeName = `${safeStem}${extension}`;
  if (!safeName || safeName === extension || safeName.includes("..")) {
    throw new OperatorSurfaceError(`attachment safe filename 为空`);
  }
  return safeName;
}

function summarizeTaskNoteRefs(events: EventRecord[]): OperatorTaskNoteRef[] {
  return events
    .filter((event) => event.type === "task.note_added" && event.artifactRefs.length > 0)
    .slice(-8)
    .map((event) => {
      const payload = isRecord(event.payload) ? event.payload : undefined;
      return {
        eventId: event.id,
        artifactPath: event.artifactRefs[0],
        summary: truncateText(readString(payload, "excerpt") ?? event.summary, 180) ?? event.summary,
        actor: readString(payload, "actor"),
        createdAt: event.createdAt
      };
    });
}

function deriveCurrentBlocker(input: {
  task: TaskRecord;
  workspace?: WorkspaceRecord;
  workflowRun?: WorkflowRunRecord;
  agentSession?: AgentSessionRecord;
  humanRequests: HumanRequestRecord[];
  latestPullRequest: PullRequestRecord | undefined;
}): string {
  const { task, workspace, workflowRun, agentSession, humanRequests, latestPullRequest } = input;
  const pendingHuman = humanRequests.find((request) => request.status === "pending");
  if (pendingHuman) {
    return `waiting human: ${pendingHuman.kind}`;
  }
  if (workspace && workspace.status === "blocked") {
    return `workspace blocked: ${workspace.id}`;
  }
  if (workflowRun && (workflowRun.status === "blocked" || workflowRun.status === "unknown")) {
    return `workflow ${workflowRun.status}: ${workflowRun.profileId}`;
  }
  if (agentSession && (agentSession.status === "stalled" || agentSession.status === "unknown")) {
    return `agent session ${agentSession.status}: ${agentSession.id}`;
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

function buildOperatorTaskDiagnosis(input: {
  currentBlocker: string;
  attempt?: AttemptRecord;
  workspace?: WorkspaceRecord;
  currentWorkflowRun?: WorkflowRunRecord;
  latestPullRequest?: PullRequestRecord;
  currentAgentSession?: AgentSessionRecord;
  events: EventRecord[];
  operations: OperationRecord[];
  humanRequests: HumanRequestRecord[];
}): OperatorTaskDiagnosis {
  const recoveryTimeline = input.events
    .filter((event) => event.type === "daemon.recovery_decision")
    .slice(-8)
    .map(mapRecoveryEventSummary);
  const retryEvents = input.events.filter((event) =>
    event.type === "daemon.retry_scheduled" ||
    event.type === "operator.task_retry_requested" ||
    event.type === "operator.task_resumed"
  );
  const retryBudgetExhausted = [...input.events].reverse().find((event) => event.type === "daemon.retry_budget_exhausted");
  const operationLedger = input.operations.map(mapOperationSummary);
  const providerProtocolInspections = input.events.filter(isInspectionEvent).slice(-10).map(mapInspectionSummary);
  const latestAttentionRecovery = findLatestOperatorAttentionRecovery(
    recoveryTimeline.filter((item) =>
      isCurrentRecoverySummary(item, {
        attempt: input.attempt,
        workspace: input.workspace,
        currentWorkflowRun: input.currentWorkflowRun,
        latestPullRequest: input.latestPullRequest,
        currentAgentSession: input.currentAgentSession
      })
    )
  );
  const operatorAttentionReasons = deriveOperatorAttentionReasons({
    latestAttentionRecovery,
    workspace: input.workspace,
    currentWorkflowRun: input.currentWorkflowRun,
    latestPullRequest: input.latestPullRequest,
    currentAgentSession: input.currentAgentSession,
    humanRequests: input.humanRequests,
    retryBudgetExhausted
  });

  return {
    currentBlocker: input.currentBlocker,
    operatorAttention: {
      required: operatorAttentionReasons.length > 0,
      reasons: operatorAttentionReasons
    },
    retryBudget: {
      scheduledCount: retryEvents.length,
      latestDueAt: deriveLatestRetryDueAt(retryEvents),
      exhausted: Boolean(retryBudgetExhausted),
      lastReason: retryBudgetExhausted?.summary ?? recoveryTimeline.find((item) => item.nextAction === "retry_later")?.reasonCode
    },
    operationLedger,
    recoveryTimeline,
    providerProtocolInspections
  };
}

function mapOperationSummary(operation: OperationRecord): OperatorOperationSummary {
  const observed = isRecord(operation.lastObservedState) ? operation.lastObservedState : undefined;
  return {
    id: operation.id,
    kind: operation.kind,
    status: operation.status,
    failureCode: operation.failureCode,
    externalId: truncateText(operation.externalId, 160),
    lastDecision: readString(observed, "decision"),
    lastReasonCode: readString(observed, "reasonCode"),
    lastError: truncateText(readString(observed, "error"), 240),
    lastObservedSummary: truncateText(readString(observed, "observedSummary"), 240)
  };
}

function mapRecoveryEventSummary(event: EventRecord): OperatorRecoverySummary {
  const payload = isRecord(event.payload) ? event.payload : undefined;
  const artifactRefs = readStringArray(payload, "artifactRefs");
  return {
    eventId: event.id,
    resourceKind: readString(payload, "resourceKind"),
    resourceId: truncateText(readString(payload, "resourceId"), 160),
    attemptId: event.attemptId,
    operationId: readString(payload, "operationId") ?? event.operationId,
    decision: readString(payload, "decision"),
    reasonCode: readString(payload, "reasonCode"),
    observedSummary: truncateText(readString(payload, "observedSummary"), 240),
    nextAction: readString(payload, "nextAction"),
    retryDueAt: readString(payload, "retryDueAt"),
    operatorAttentionRequired: readBoolean(payload, "operatorAttentionRequired") === true,
    artifactRefs: artifactRefs.length > 0 ? artifactRefs : event.artifactRefs,
    severity: event.severity,
    createdAt: event.createdAt
  };
}

function mapInspectionSummary(event: EventRecord): OperatorInspectionSummary {
  return {
    eventId: event.id,
    type: event.type,
    summary: truncateText(event.summary, 240) ?? event.type,
    resource: deriveInspectionResource(event),
    operationId: event.operationId,
    artifactRefs: event.artifactRefs,
    severity: event.severity,
    createdAt: event.createdAt
  };
}

function mapCoordinatorToolSummary(event: EventRecord): OperatorExecutionSummary["coordinatorTools"][number] {
  const payload = isRecord(event.payload) ? event.payload : undefined;
  return {
    eventId: event.id,
    toolName: readString(payload, "toolName"),
    status: readString(payload, "status") ?? readString(payload, "toolStatus"),
    summary: truncateText(event.summary, 240) ?? event.type,
    artifactRefs: event.artifactRefs,
    extraArtifact: event.type === "daemon.agent_extra_artifact_written"
  };
}

function summarizeArtifactRefs(events: EventRecord[]): OperatorExecutionSummary["artifacts"] {
  const byPath = new Map<string, OperatorExecutionSummary["artifacts"][number]>();
  for (const event of events) {
    for (const ref of event.artifactRefs) {
      if (!byPath.has(ref)) {
        byPath.set(ref, {
          path: ref,
          sourceEventType: event.type,
          extra: event.type === "daemon.agent_extra_artifact_written"
        });
        continue;
      }
      const existing = byPath.get(ref);
      if (existing && event.type === "daemon.agent_extra_artifact_written") {
        existing.extra = true;
      }
    }
  }
  return [...byPath.values()].slice(-20);
}

function deriveOperatorAttentionReasons(input: {
  latestAttentionRecovery?: OperatorRecoverySummary;
  workspace?: WorkspaceRecord;
  currentWorkflowRun?: WorkflowRunRecord;
  latestPullRequest?: PullRequestRecord;
  currentAgentSession?: AgentSessionRecord;
  humanRequests: HumanRequestRecord[];
  retryBudgetExhausted?: EventRecord;
}): string[] {
  const reasons = new Set<string>();
  if (input.latestAttentionRecovery) {
    reasons.add(input.latestAttentionRecovery.reasonCode ?? `${input.latestAttentionRecovery.resourceKind ?? "resource"} requires operator attention`);
  }
  if (input.workspace && input.workspace.status === "blocked") {
    reasons.add(`workspace blocked: ${input.workspace.id}`);
  }
  if (input.retryBudgetExhausted) {
    reasons.add("retry budget exhausted");
  }
  if (input.currentWorkflowRun && (input.currentWorkflowRun.status === "unknown" || input.currentWorkflowRun.status === "blocked")) {
    reasons.add(`workflow ${input.currentWorkflowRun.status}: ${input.currentWorkflowRun.profileId}`);
  }
  if (input.latestPullRequest && (input.latestPullRequest.status === "closed" || input.latestPullRequest.status === "conflict")) {
    reasons.add(`PR/MR ${input.latestPullRequest.status}: ${input.latestPullRequest.id}`);
  }
  if (input.currentAgentSession) {
    reasons.add(`agent session ${input.currentAgentSession.status}: ${input.currentAgentSession.id}`);
  }
  for (const request of input.humanRequests) {
    if (request.status === "pending") {
      reasons.add(`waiting human: ${request.kind}`);
    }
  }
  return [...reasons].slice(0, 8);
}

function findLatestOperatorAttentionRecovery(recoveryTimeline: OperatorRecoverySummary[]): OperatorRecoverySummary | undefined {
  return [...recoveryTimeline].reverse().find((item) => item.operatorAttentionRequired || item.decision === "operator_attention");
}

function isCurrentRecoverySummary(
  item: OperatorRecoverySummary,
  current: {
    attempt?: AttemptRecord;
    workspace?: WorkspaceRecord;
    currentWorkflowRun?: WorkflowRunRecord;
    latestPullRequest?: PullRequestRecord;
    currentAgentSession?: AgentSessionRecord;
  }
): boolean {
  if (item.resourceKind === "workspace") {
    return Boolean(current.workspace && item.resourceId === current.workspace.id);
  }
  if (item.resourceKind === "workflow_run") {
    return Boolean(current.currentWorkflowRun && item.resourceId === current.currentWorkflowRun.id);
  }
  if (item.resourceKind === "pull_request") {
    return Boolean(current.latestPullRequest && item.resourceId === current.latestPullRequest.id);
  }
  if (item.resourceKind === "agent_session") {
    return Boolean(current.currentAgentSession && item.resourceId === current.currentAgentSession.id);
  }
  if (item.resourceKind === "operation" || item.resourceKind === "lock" || item.resourceKind === "task_gate" || item.resourceKind === "pr-merge") {
    return isCurrentRecoveryByAttempt(item, current.attempt);
  }
  return false;
}

function isCurrentRecoveryByAttempt(item: OperatorRecoverySummary, attempt: AttemptRecord | undefined): boolean {
  if (!attempt) {
    return false;
  }
  return item.attemptId === attempt.id;
}

function findCurrentWorkflowRun(workflowRuns: WorkflowRunRecord[], attempt: AttemptRecord | undefined): WorkflowRunRecord | undefined {
  if (!attempt) {
    return undefined;
  }
  return workflowRuns.find((run) => run.attemptId === attempt.id && isCurrentWorkflowRunStatus(run.status));
}

function findCurrentPullRequest(pullRequests: PullRequestRecord[], attempt: AttemptRecord | undefined): PullRequestRecord | undefined {
  if (!attempt) {
    return undefined;
  }
  return pullRequests.find((pr) => pr.attemptId === attempt.id);
}

function findCurrentAgentSession(
  agentSessions: AgentSessionRecord[],
  attempt: AttemptRecord | undefined,
  statusPredicate: (status: string) => boolean
): AgentSessionRecord | undefined {
  const candidates = agentSessions.filter((session) => session.role === "outer" && statusPredicate(session.status));
  if (!attempt) {
    return candidates.find((session) => !session.attemptId);
  }
  const attemptScoped = candidates.find((session) => session.attemptId === attempt.id);
  if (attemptScoped) {
    return attemptScoped;
  }
  // 现有 outer agent session 是 task-scoped 创建的，不能因为缺少 attemptId 就丢失当前探活信号。
  return candidates.find((session) => !session.attemptId);
}

function deriveLatestRetryDueAt(events: EventRecord[]): string | undefined {
  for (const event of [...events].reverse()) {
    const payload = isRecord(event.payload) ? event.payload : undefined;
    const dueAt = readString(payload, "dueAt") ?? readString(payload, "retryDueAt");
    if (dueAt) {
      return dueAt;
    }
  }
  return undefined;
}

function isInspectionEvent(event: EventRecord): boolean {
  return INSPECTION_EVENT_TYPES.has(event.type);
}

const INSPECTION_EVENT_TYPES = new Set([
  "daemon.recovery_decision",
  "workflow.status_inspected",
  "workflow.artifacts_inspected",
  "workflow.events_inspected",
  "pr.review_inspected",
  "pr.merge_snapshot_inspected",
  "pr.recovery_decision"
]);

function deriveInspectionResource(event: EventRecord): string | undefined {
  if (event.workflowRunId) return `workflow:${event.workflowRunId}`;
  if (event.prId) return `pr:${event.prId}`;
  if (event.agentSessionId) return `agent_session:${event.agentSessionId}`;
  if (event.workspaceId) return `workspace:${event.workspaceId}`;
  if (event.humanRequestId) return `human_request:${event.humanRequestId}`;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readBoolean(record: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = record?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(record: Record<string, unknown> | undefined, key: string): string[] {
  const value = record?.[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function truncateText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function isActiveAgentSessionStatus(status: string): boolean {
  return status === "planned" || status === "starting" || status === "running" || status === "stalled" || status === "unknown";
}

function isCurrentAgentAttentionStatus(status: string): boolean {
  return status === "stalled" || status === "unknown";
}

function isCurrentWorkflowRunStatus(status: string): boolean {
  return status === "planned" || status === "starting" || status === "running" || status === "blocked" || status === "handoff" || status === "unknown";
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

function normalizeWorkflowProfile(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized === "auto" || normalized === "default") {
    return undefined;
  }
  if (/^[a-z0-9][a-z0-9-]{0,79}$/.test(normalized)) {
    return normalized;
  }
  throw new OperatorSurfaceError(`不支持的 workflow profile：${value}`);
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
