import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, normalize, relative, resolve, sep } from "node:path";
import {
  ActiveResourceConflictError,
  appendEvent,
  createArtifact,
  createOperation,
  getActiveAgentSessionByTask,
  getHumanRequest,
  getOperationByIdempotencyKey,
  getTask,
  listHumanRequestsByStatus,
  listTasks,
  listWorkflowRunsByStatus,
  updateHumanRequest,
  updateAgentSession,
  updateOperation,
  updateTaskStatus,
  type DbContext,
  type HumanRequestRecord,
  type TaskRecord,
  type WorkflowRunRecord
} from "@coordinator/db";
import {
  CoordinatorAgentToolError,
  executeCoordinatorAgentTool,
  type CoordinatorAgentToolArgs,
  type CoordinatorAgentToolName
} from "./coordinator-agent-tools.js";
import {
  AgentProviderRuntimeError,
  runCoordinatorAgentSession,
  type AgentProvider,
  type RunCoordinatorAgentSessionInput
} from "./agent-provider-runtime.js";
import { buildTaskSurfaceFromDb } from "./surface.js";
import {
  WorkflowProtocolError,
  inspectWorkflowRun,
  type InspectWorkflowRunInput,
  type WorkflowProtocolRunner
} from "./workflow-protocol-adapter.js";

const DEFAULT_DAEMON_CANDIDATE_LIMIT = 10;
const DEFAULT_RETRY_BUDGET = 3;
const DEFAULT_AGENT_STALLED_MS = 20 * 60 * 1000;
const DEFAULT_RETRY_BACKOFF_MS = [10_000, 30_000, 60_000, 120_000, 300_000];
const MAX_DAEMON_ARTIFACT_BYTES = 256 * 1024;

export type DaemonRuntimeInput = {
  owner?: string;
  candidateLimit?: number;
  retryBudget?: number;
  now?: Date;
  provider?: AgentProvider;
  providerId?: string;
  workflowInspectRunner?: WorkflowProtocolRunner;
};

export type DaemonTickResult = {
  tickId: string;
  status: "idle" | "acted" | "failed";
  actions: DaemonActionResult[];
};

export type DaemonActionResult = {
  kind:
    | "workflow_inspected"
    | "human_wake_up"
    | "agent_session_started"
    | "agent_tool_executed"
    | "agent_tool_skipped"
    | "retry_blocked"
    | "reconcile_failed";
  taskId?: string;
  workflowRunId?: string;
  humanRequestId?: string;
  agentSessionId?: string;
  toolName?: string;
  status: "succeeded" | "failed" | "skipped";
  summary: string;
};

export type ParsedAgentToolRequest = {
  toolName: CoordinatorAgentToolName | string;
  args: CoordinatorAgentToolArgs;
};

export type ParsedCoordinatorArtifact = {
  path: string;
  content: string;
};

export class DaemonRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DaemonRuntimeError";
  }
}

export function runDaemonTick(context: DbContext, input: DaemonRuntimeInput = {}): DaemonTickResult {
  const tickId = randomUUID();
  const owner = normalizeOwner(input.owner ?? "daemon");
  const now = input.now ?? new Date();
  const actions: DaemonActionResult[] = [];
  const touchedTaskIds = new Set<string>();

  appendEvent(context, {
    type: "daemon.tick_started",
    summary: `daemon tick started: ${tickId}`,
    payload: { tickId, owner },
    severity: "debug"
  });

  actions.push(...watchActiveAgentSessions(context, tickId, owner, now));
  actions.push(...reconcileWorkflowRuns(context, tickId, owner, input));
  actions.push(...wakeAnsweredHumanRequests(context, tickId, owner, now, input, touchedTaskIds));
  actions.push(...advanceCandidateTasks(context, tickId, owner, now, input, touchedTaskIds));

  appendEvent(context, {
    type: "daemon.tick_completed",
    summary: `daemon tick completed: ${tickId}`,
    payload: {
      tickId,
      owner,
      actionCount: actions.length,
      actions: actions.map((action) => ({
        kind: action.kind,
        taskId: action.taskId,
        status: action.status
      }))
    },
    severity: actions.some((action) => action.status === "failed") ? "warn" : "debug"
  });

  return {
    tickId,
    status: actions.length === 0 ? "idle" : actions.some((action) => action.status === "failed") ? "failed" : "acted",
    actions
  };
}

export function parseAgentToolRequest(finalResponse: string): ParsedAgentToolRequest | undefined {
  const match = finalResponse.match(/```coordinator-tool\s*\n([\s\S]*?)```/m);
  if (!match) {
    return undefined;
  }
  const lines = match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const values: Record<string, string> = {};
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      throw new DaemonRuntimeError(`coordinator-tool 行缺少冒号：${line}`);
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!key || !value) {
      throw new DaemonRuntimeError(`coordinator-tool 行为空：${line}`);
    }
    values[key] = value;
  }
  const toolName = values.tool;
  if (!toolName) {
    throw new DaemonRuntimeError("coordinator-tool 缺少 tool 字段");
  }
  delete values.tool;
  // 这个文本协议故意保持一层 key/value，避免让 outer agent 手写复杂 JSON。
  return { toolName, args: values };
}

export function parseCoordinatorArtifacts(finalResponse: string): ParsedCoordinatorArtifact[] {
  const artifacts: ParsedCoordinatorArtifact[] = [];
  const pattern = /```coordinator-artifact\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(finalResponse)) !== null) {
    artifacts.push(parseCoordinatorArtifactBlock(match[1]));
  }
  return artifacts;
}

function reconcileWorkflowRuns(
  context: DbContext,
  tickId: string,
  owner: string,
  input: DaemonRuntimeInput
): DaemonActionResult[] {
  const runs = listWorkflowRunsByStatus(context, ["starting", "running", "blocked", "unknown"], input.candidateLimit ?? 5);
  const actions: DaemonActionResult[] = [];
  for (const run of runs) {
    actions.push(reconcileWorkflowRun(context, run, tickId, owner, input.workflowInspectRunner));
  }
  return actions;
}

function watchActiveAgentSessions(context: DbContext, tickId: string, owner: string, now: Date): DaemonActionResult[] {
  const rows = context.db
    .prepare(
      `SELECT id, project_id, task_id, attempt_id, provider_kind, role, status, updated_at
       FROM agent_sessions
       WHERE role = 'outer' AND status IN ('starting', 'running')
       ORDER BY updated_at ASC, created_at ASC, id ASC`
    )
    .all() as Array<{
    id: string;
    project_id: string;
    task_id: string | null;
    attempt_id: string | null;
    provider_kind: string;
    role: string;
    status: string;
    updated_at: string;
  }>;
  const actions: DaemonActionResult[] = [];
  for (const row of rows) {
    const ageMs = now.getTime() - Date.parse(row.updated_at);
    if (Number.isNaN(ageMs) || ageMs < DEFAULT_AGENT_STALLED_MS) {
      continue;
    }
    const operationKey = `daemon:agent:stale:${row.id}`;
    const existing = getOperationByIdempotencyKey(context, operationKey);
    if (existing && isTerminalOperationStatus(existing.status)) {
      continue;
    }
    const operation = createOperation(context, {
      idempotencyKey: operationKey,
      kind: "daemon:agent:stale",
      projectId: row.project_id,
      taskId: row.task_id ?? undefined,
      attemptId: row.attempt_id ?? undefined
    });
    updateOperation(context, {
      operationId: operation.id,
      status: "running",
      now,
      lastObservedState: { tickId, owner, agentSessionId: row.id, ageMs }
    });
    appendEvent(context, {
      type: "daemon.agent_session_stalled",
      summary: `agent session stalled: ${row.id}`,
      projectId: row.project_id,
      taskId: row.task_id ?? undefined,
      attemptId: row.attempt_id ?? undefined,
      agentSessionId: row.id,
      operationId: operation.id,
      severity: "warn",
      payload: { tickId, ageMs, providerKind: row.provider_kind, role: row.role }
    });
    if (row.task_id) {
      const task = getTask(context, row.task_id);
      if (task && !["paused", "canceled", "waiting_human", "waiting_review", "waiting_merge_approval"].includes(task.status)) {
        scheduleTaskRetry(context, task.id, now, tickId, "stalled-agent-session");
      }
    }
    // stale session 需要离开 active 集合，否则 retry_due 会被 active outer session 唯一性永久挡住。
    const latestSession = context.db.prepare("SELECT state_version FROM agent_sessions WHERE id = ?").get(row.id) as
      | { state_version: number }
      | undefined;
    if (latestSession) {
      updateAgentSession(context, {
        agentSessionId: row.id,
        expectedStateVersion: latestSession.state_version,
        status: "stopped"
      });
    }
    updateOperation(context, {
      operationId: operation.id,
      status: "succeeded",
      now,
      lastObservedState: { tickId, agentSessionId: row.id, action: "retry-scheduled" }
    });
    actions.push({
      kind: "reconcile_failed",
      taskId: row.task_id ?? undefined,
      agentSessionId: row.id,
      status: "failed",
      summary: `agent session ${row.id} stalled`
    });
  }
  return actions;
}

function reconcileWorkflowRun(
  context: DbContext,
  run: WorkflowRunRecord,
  tickId: string,
  owner: string,
  runner: WorkflowProtocolRunner | undefined
): DaemonActionResult {
  const operation = createOperation(context, {
    idempotencyKey: `daemon:workflow:inspect:${run.id}:${tickId}`,
    kind: "daemon:workflow:inspect",
    projectId: run.projectId,
    taskId: run.taskId,
    attemptId: run.attemptId
  });
  updateOperation(context, {
    operationId: operation.id,
    status: "running",
    lastObservedState: { tickId, workflowRunId: run.id, owner }
  });

  try {
    const result = inspectWorkflowRun(context, buildWorkflowInspectInput(run.id, runner));
    updateOperation(context, {
      operationId: operation.id,
      status: "succeeded",
      lastObservedState: {
        workflowRunId: result.workflowRun.id,
        status: result.workflowRun.status,
        handoffKind: result.workflowRun.handoffKind
      }
    });
    appendEvent(context, {
      type: "daemon.workflow_reconciled",
      summary: `daemon inspected workflow run: ${run.id}`,
      projectId: run.projectId,
      taskId: run.taskId,
      attemptId: run.attemptId,
      workflowRunId: run.id,
      operationId: operation.id,
      payload: { tickId, status: result.workflowRun.status, handoffKind: result.workflowRun.handoffKind }
    });
    return {
      kind: "workflow_inspected",
      taskId: run.taskId,
      workflowRunId: run.id,
      status: "succeeded",
      summary: `workflow run ${run.id} inspected`
    };
  } catch (error) {
    updateOperation(context, {
      operationId: operation.id,
      status: "unknown",
      failureCode: error instanceof Error ? error.name : "unknown",
      lastObservedState: { tickId, workflowRunId: run.id, error: error instanceof Error ? error.message : String(error) }
    });
    appendEvent(context, {
      type: "daemon.workflow_reconcile_failed",
      summary: `daemon failed to inspect workflow run: ${run.id}`,
      projectId: run.projectId,
      taskId: run.taskId,
      attemptId: run.attemptId,
      workflowRunId: run.id,
      operationId: operation.id,
      severity: "warn",
      payload: {
        tickId,
        error: error instanceof Error ? error.message : String(error),
        invariant: "workflow 不可用时不能静默推进 completed"
      }
    });
    return {
      kind: "reconcile_failed",
      taskId: run.taskId,
      workflowRunId: run.id,
      status: "failed",
      summary: `workflow run ${run.id} reconcile failed`
    };
  }
}

function wakeAnsweredHumanRequests(
  context: DbContext,
  tickId: string,
  owner: string,
  now: Date,
  input: DaemonRuntimeInput,
  touchedTaskIds: Set<string>
): DaemonActionResult[] {
  const requests = listHumanRequestsByStatus(context, ["answered"], input.candidateLimit ?? 5);
  return requests.flatMap((request) => {
    const actions = wakeAnsweredHumanRequest(context, request, tickId, owner, now, input);
    touchedTaskIds.add(request.taskId);
    return actions;
  });
}

function wakeAnsweredHumanRequest(
  context: DbContext,
  request: HumanRequestRecord,
  tickId: string,
  owner: string,
  now: Date,
  input: DaemonRuntimeInput
): DaemonActionResult[] {
  const currentTask = requireTask(context, request.taskId);
  if (currentTask.status === "paused" || currentTask.status === "canceled") {
    return [
      {
        kind: "retry_blocked",
        taskId: request.taskId,
        humanRequestId: request.id,
        status: "skipped",
        summary: `human wake-up skipped because task is ${currentTask.status}`
      }
    ];
  }
  const operation = createOperation(context, {
    idempotencyKey: `daemon:human:wake:${request.id}:${request.stateVersion}`,
    kind: "daemon:human:wake",
    projectId: request.projectId,
    taskId: request.taskId,
    attemptId: request.attemptId
  });
  updateOperation(context, {
    operationId: operation.id,
    status: "running",
    now,
    lastObservedState: { tickId, humanRequestId: request.id, owner }
  });

  try {
    const task = requireTask(context, request.taskId);
    if (task.status === "waiting_human" || task.status === "created" || task.status === "planning" || task.status === "running") {
      updateTaskStatus(context, task.id, task.stateVersion, "human_answered");
    }
    const refreshed = getHumanRequest(context, request.id) ?? request;
    if (refreshed.status === "answered") {
      updateHumanRequest(context, {
        humanRequestId: refreshed.id,
        expectedStateVersion: refreshed.stateVersion,
        status: "consumed"
      });
    }
    updateOperation(context, {
      operationId: operation.id,
      status: "succeeded",
      now,
      lastObservedState: { tickId, humanRequestId: request.id, taskStatus: "human_answered" }
    });
    appendEvent(context, {
      type: "daemon.human_wake_up",
      summary: `daemon woke task from human answer: ${request.taskId}`,
      projectId: request.projectId,
      taskId: request.taskId,
      attemptId: request.attemptId,
      operationId: operation.id,
      payload: { tickId, humanRequestId: request.id }
    });
    const action: DaemonActionResult = {
      kind: "human_wake_up",
      taskId: request.taskId,
      humanRequestId: request.id,
      status: "succeeded",
      summary: `human request ${request.id} consumed`
    };
    const followUp = advanceTaskWithAgent(context, request.taskId, tickId, owner, now, input, "human_answered");
    return followUp ? [action, followUp] : [action];
  } catch (error) {
    updateOperation(context, {
      operationId: operation.id,
      status: "failed",
      now,
      failureCode: error instanceof Error ? error.name : "unknown",
      lastObservedState: { tickId, error: error instanceof Error ? error.message : String(error) }
    });
    appendEvent(context, {
      type: "daemon.human_wake_up_failed",
      summary: `daemon failed to wake task from human answer: ${request.taskId}`,
      projectId: request.projectId,
      taskId: request.taskId,
      attemptId: request.attemptId,
      operationId: operation.id,
      severity: "warn",
      payload: { tickId, error: error instanceof Error ? error.message : String(error) }
    });
    return [{
      kind: "reconcile_failed",
      taskId: request.taskId,
      humanRequestId: request.id,
      status: "failed",
      summary: `human request ${request.id} wake-up failed`
    }];
  }
}

function advanceCandidateTasks(
  context: DbContext,
  tickId: string,
  owner: string,
  now: Date,
  input: DaemonRuntimeInput,
  touchedTaskIds: Set<string>
): DaemonActionResult[] {
  const tasks = listTasks(context, {
    statuses: ["created", "planning", "human_answered", "running", "resuming"],
    limit: input.candidateLimit ?? DEFAULT_DAEMON_CANDIDATE_LIMIT
  });
  const actions: DaemonActionResult[] = [];
  for (const task of tasks) {
    if (touchedTaskIds.has(task.id)) {
      continue;
    }
    const action = advanceTaskWithAgent(context, task.id, tickId, owner, now, input, deriveWakeReason(task));
    if (action) {
      touchedTaskIds.add(task.id);
      actions.push(action);
    }
  }
  return actions;
}

function advanceTaskWithAgent(
  context: DbContext,
  taskId: string,
  tickId: string,
  owner: string,
  now: Date,
  input: DaemonRuntimeInput,
  wakeReason: string
): DaemonActionResult | undefined {
  const task = requireTask(context, taskId);
  const surface = buildTaskSurfaceFromDb(context, task.id);
  if (surface.json.available_tools.length === 0) {
    return undefined;
  }
  if (getActiveAgentSessionByTask(context, task.id, "outer")) {
    return undefined;
  }

  const retryCheck = ensureRetryBudget(context, task, tickId, input.retryBudget ?? DEFAULT_RETRY_BUDGET);
  if (retryCheck) {
    return retryCheck;
  }

  const retryDelayCheck = ensureRetryDelay(context, task, now);
  if (retryDelayCheck) {
    return retryDelayCheck;
  }

  const requestId = `daemon-${wakeReason}-v${task.stateVersion}`;
  const providerId = input.provider?.id ?? input.providerId ?? surface.json.project.outer_agent_default_provider ?? "codex";
  const previousAgentOperation = getOperationByIdempotencyKey(
    context,
    `agent:session:${task.id}:outer:${providerId}:${requestId}`
  );
  if (previousAgentOperation && isTerminalOperationStatus(previousAgentOperation.status)) {
    appendEvent(context, {
      type: "daemon.agent_session_skipped",
      summary: `daemon skipped already processed task snapshot: ${task.id}`,
      projectId: task.projectId,
      taskId: task.id,
      severity: "debug",
      payload: { tickId, requestId, operationStatus: previousAgentOperation.status }
    });
    return {
      kind: "agent_tool_skipped",
      taskId: task.id,
      status: "skipped",
      summary: `task snapshot already processed: ${requestId}`
    };
  }
  const sessionInput: RunCoordinatorAgentSessionInput = {
    taskId: task.id,
    provider: input.provider,
    providerId: input.providerId,
    requestId,
    owner
  };
  try {
    const session = runCoordinatorAgentSession(context, sessionInput);
    appendEvent(context, {
      type: "daemon.agent_session_started",
      summary: `daemon ran coordinator agent for task: ${task.id}`,
      projectId: task.projectId,
      taskId: task.id,
      agentSessionId: session.session.id,
      operationId: session.operationId,
      payload: { tickId, surfaceId: session.surfaceId }
    });

    const writtenArtifacts = writeCoordinatorArtifacts(context, surface, session.finalResponse, owner, tickId, session.session.id);
    const toolRequest = parseAgentToolRequest(session.finalResponse);
    if (!toolRequest) {
      appendEvent(context, {
        type: "daemon.agent_tool_skipped",
        summary: `agent did not request a coordinator tool: ${task.id}`,
        projectId: task.projectId,
        taskId: task.id,
        agentSessionId: session.session.id,
        artifactRefs: writtenArtifacts,
        payload: { tickId, reason: "missing-coordinator-tool-block" },
        severity: "debug"
      });
      return {
        kind: "agent_tool_skipped",
        taskId: task.id,
        agentSessionId: session.session.id,
        status: "skipped",
        summary: "agent session completed without coordinator-tool request"
      };
    }

    const toolResult = executeCoordinatorAgentTool(context, {
      taskId: task.id,
      toolName: toolRequest.toolName,
      args: toolRequest.args,
      actor: owner,
      agentSessionId: session.session.id
    });
    appendEvent(context, {
      type: "daemon.agent_tool_executed",
      summary: `daemon executed requested agent tool: ${toolRequest.toolName}`,
      projectId: task.projectId,
      taskId: task.id,
      agentSessionId: session.session.id,
      artifactRefs: writtenArtifacts,
      payload: { tickId, toolName: toolRequest.toolName, toolStatus: toolResult.status }
    });
    return {
      kind: "agent_tool_executed",
      taskId: task.id,
      agentSessionId: session.session.id,
      toolName: toolRequest.toolName,
      status: "succeeded",
      summary: `executed ${toolRequest.toolName}`
    };
  } catch (error) {
    if (
      error instanceof CoordinatorAgentToolError ||
      error instanceof AgentProviderRuntimeError ||
      error instanceof WorkflowProtocolError ||
      error instanceof ActiveResourceConflictError ||
      error instanceof DaemonRuntimeError
    ) {
      const retryOutcome = scheduleTaskRetry(context, task.id, now, tickId, error.message);
      appendEvent(context, {
        type: "daemon.advance_failed",
        summary: `daemon failed to advance task: ${task.id}`,
        projectId: task.projectId,
        taskId: task.id,
        severity: "warn",
        payload: { tickId, error: error.message, errorName: error.name, retryOutcome }
      });
      if (retryOutcome === "scheduled") {
        return {
          kind: "retry_blocked",
          taskId: task.id,
          status: "skipped",
          summary: `task ${task.id} scheduled for retry`
        };
      }
      if (retryOutcome === "exhausted") {
        return {
          kind: "retry_blocked",
          taskId: task.id,
          status: "skipped",
          summary: `retry budget exhausted for task ${task.id}`
        };
      }
      return {
        kind: "reconcile_failed",
        taskId: task.id,
        status: "failed",
        summary: error.message
      };
    }
    throw error;
  }
}

function ensureRetryBudget(
  context: DbContext,
  task: TaskRecord,
  tickId: string,
  retryBudget: number
): DaemonActionResult | undefined {
  const recentFailures = context.db
    .prepare(
      `SELECT COUNT(*) AS count FROM events
       WHERE task_id = ? AND type = 'daemon.advance_failed'`
    )
    .get(task.id) as { count: number } | undefined;
  const count = recentFailures?.count ?? 0;
  if (count < retryBudget) {
    return undefined;
  }
  appendEvent(context, {
    type: "daemon.retry_budget_exhausted",
    summary: `daemon retry budget exhausted: ${task.id}`,
    projectId: task.projectId,
    taskId: task.id,
    severity: "warn",
    payload: { tickId, retryBudget, observedFailures: count }
  });
  return {
    kind: "retry_blocked",
    taskId: task.id,
    status: "skipped",
    summary: `retry budget exhausted for task ${task.id}`
  };
}

function ensureRetryDelay(context: DbContext, task: TaskRecord, now: Date): DaemonActionResult | undefined {
  if (task.status !== "resuming") {
    return undefined;
  }
  const schedule = getLatestRetrySchedule(context, task.id);
  if (!schedule) {
    return {
      kind: "retry_blocked",
      taskId: task.id,
      status: "skipped",
      summary: `task ${task.id} is resuming but retry schedule is missing`
    };
  }
  if (Date.parse(schedule.dueAt) > now.getTime()) {
    return {
      kind: "retry_blocked",
      taskId: task.id,
      status: "skipped",
      summary: `task ${task.id} retry not due yet`
    };
  }
  return undefined;
}

function scheduleTaskRetry(
  context: DbContext,
  taskId: string,
  now: Date,
  tickId: string,
  reason: string
): "scheduled" | "exhausted" | "already-terminal" {
  const task = requireTask(context, taskId);
  if (["failed", "completed", "handoff", "canceled"].includes(task.status)) {
    return "already-terminal";
  }
  const failureCount = countTaskRetryEvents(context, task.id);
  if (failureCount >= DEFAULT_RETRY_BACKOFF_MS.length) {
    updateTaskStatus(context, task.id, task.stateVersion, "failed");
    appendEvent(context, {
      type: "daemon.retry_budget_exhausted",
      summary: `daemon retry budget exhausted: ${task.id}`,
      projectId: task.projectId,
      taskId: task.id,
      severity: "warn",
      payload: { tickId, reason, observedFailures: failureCount }
    });
    return "exhausted";
  }
  const delayMs = DEFAULT_RETRY_BACKOFF_MS[Math.min(failureCount, DEFAULT_RETRY_BACKOFF_MS.length - 1)];
  const dueAt = new Date(now.getTime() + delayMs).toISOString();
  updateTaskStatus(context, task.id, task.stateVersion, "resuming");
  appendEvent(context, {
    type: "daemon.retry_scheduled",
    summary: `daemon retry scheduled: ${task.id}`,
    projectId: task.projectId,
    taskId: task.id,
    payload: { tickId, reason, dueAt, attempt: failureCount + 1, delayMs }
  });
  return "scheduled";
}

function countTaskRetryEvents(context: DbContext, taskId: string): number {
  const row = context.db
    .prepare(
      `SELECT COUNT(*) AS count FROM events
       WHERE task_id = ? AND type IN ('daemon.retry_scheduled', 'daemon.advance_failed', 'daemon.agent_session_stalled')`
    )
    .get(taskId) as { count: number } | undefined;
  return row?.count ?? 0;
}

function getLatestRetrySchedule(context: DbContext, taskId: string): { dueAt: string } | undefined {
  const row = context.db
    .prepare(
      `SELECT payload_json FROM events
       WHERE task_id = ? AND type IN ('daemon.retry_scheduled', 'operator.task_retry_requested', 'operator.task_resumed')
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    )
    .get(taskId) as { payload_json: string | null } | undefined;
  if (!row?.payload_json) {
    return undefined;
  }
  const payload = JSON.parse(row.payload_json) as { dueAt?: string };
  return payload.dueAt ? { dueAt: payload.dueAt } : undefined;
}

function writeCoordinatorArtifacts(
  context: DbContext,
  surface: ReturnType<typeof buildTaskSurfaceFromDb>,
  finalResponse: string,
  owner: string,
  tickId: string,
  agentSessionId: string
): string[] {
  const root = resolve(surface.json.artifact_root);
  mkdirSync(root, { recursive: true });
  const rootReal = realpathSync(root);
  const refs: string[] = [];
  for (const artifact of parseCoordinatorArtifacts(finalResponse)) {
    const relativePath = validateArtifactRelativePath(artifact.path);
    if (Buffer.byteLength(artifact.content, "utf8") > MAX_DAEMON_ARTIFACT_BYTES) {
      throw new DaemonRuntimeError(`coordinator artifact too large: ${relativePath}`);
    }
    const absolutePath = resolve(rootReal, relativePath);
    if (!isPathInside(rootReal, absolutePath)) {
      throw new DaemonRuntimeError(`artifact path 逃逸 root：${relativePath}`);
    }
    if (existsSync(absolutePath)) {
      const existingReal = realpathSync(absolutePath);
      if (!isPathInside(rootReal, existingReal)) {
        throw new DaemonRuntimeError(`artifact path 逃逸 root：${relativePath}`);
      }
    }
    mkdirSync(dirname(absolutePath), { recursive: true });
    const parentReal = realpathSync(dirname(absolutePath));
    if (!isPathInside(rootReal, parentReal)) {
      throw new DaemonRuntimeError(`artifact parent path 逃逸 root：${relativePath}`);
    }
    writeFileSync(absolutePath, normalizeArtifactContent(artifact.content), "utf8");
    createArtifact(context, {
      projectId: surface.json.project.id,
      taskId: surface.json.task.id,
      attemptId: surface.json.attempt?.id ?? undefined,
      kind: "coordinator-agent-artifact",
      owner,
      path: relativePath
    });
    refs.push(relativePath);
  }
  if (refs.length > 0) {
    appendEvent(context, {
      type: "daemon.agent_artifact_written",
      summary: `daemon wrote ${refs.length} coordinator artifacts`,
      projectId: surface.json.project.id,
      taskId: surface.json.task.id,
      agentSessionId,
      artifactRefs: refs,
      payload: { tickId, artifactCount: refs.length }
    });
  }
  return refs;
}

function buildWorkflowInspectInput(
  workflowRunId: string,
  runner: WorkflowProtocolRunner | undefined
): InspectWorkflowRunInput {
  return runner ? { workflowRunId, runner } : { workflowRunId };
}

function requireTask(context: DbContext, taskId: string): TaskRecord {
  const task = getTask(context, taskId);
  if (!task) {
    throw new DaemonRuntimeError(`task not found: ${taskId}`);
  }
  return task;
}

function deriveWakeReason(task: TaskRecord): string {
  if (task.status === "human_answered") {
    return "human_answered";
  }
  if (task.status === "resuming") {
    return "retry_due";
  }
  return "planning";
}

function normalizeOwner(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new DaemonRuntimeError("daemon owner 不能为空");
  }
  if (trimmed.length > 128) {
    throw new DaemonRuntimeError("daemon owner 过长");
  }
  return trimmed;
}

function isTerminalOperationStatus(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "unknown" || status === "reconciled" || status === "canceled";
}

function validateArtifactRelativePath(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (trimmed.length === 0) {
    throw new DaemonRuntimeError("artifact path 不能为空");
  }
  if (isAbsolute(trimmed)) {
    throw new DaemonRuntimeError("artifact path 不允许绝对路径");
  }
  const segments = trimmed.split(/[\\/]+/);
  if (segments.some((segment) => segment === "" || segment === "..")) {
    throw new DaemonRuntimeError("artifact path 不允许空 segment 或 ..");
  }
  const normalized = normalize(trimmed);
  if (normalized === "." || normalized === ".." || normalized.startsWith(`..${sep}`)) {
    throw new DaemonRuntimeError("artifact path 不允许逃逸 root");
  }
  return normalized;
}

function normalizeArtifactContent(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function parseCoordinatorArtifactBlock(block: string): ParsedCoordinatorArtifact {
  const lines = block.split(/\r?\n/);
  let path: string | undefined;
  let contentStart = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "content:") {
      contentStart = index + 1;
      break;
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === "path") {
      path = value;
    }
  }
  if (!path) {
    throw new DaemonRuntimeError("coordinator-artifact 缺少 path");
  }
  if (contentStart === -1) {
    throw new DaemonRuntimeError("coordinator-artifact 缺少 content");
  }
  return { path, content: lines.slice(contentStart).join("\n").trimEnd() };
}

function isPathInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
