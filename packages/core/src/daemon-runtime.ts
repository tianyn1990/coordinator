import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, normalize, relative, resolve, sep } from "node:path";
import {
  ActiveResourceConflictError,
  appendEvent,
  createArtifact,
  createOperation,
  getActiveAgentSessionByTask,
  getLatestPullRequestByTask,
  getActiveWorkflowRunByAttempt,
  getWorkflowRun,
  getHumanRequest,
  getLock,
  getOperationByIdempotencyKey,
  getTask,
  getWorkspace,
  listExpiredLocks,
  listOperationsByStatusAndKindPrefix,
  listHumanRequestsByStatus,
  listTasks,
  listWorkspacesByStatus,
  listWorkflowRunsByStatus,
  updateHumanRequest,
  updateAgentSession,
  updateOperation,
  updateTaskStatus,
  withTransaction,
  type DbContext,
  type HumanRequestRecord,
  type OperationRecord,
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
import { inspectAgentSession } from "./agent-provider-runtime.js";
import {
  decideAgentSessionRecovery,
  decideLockRecovery,
  decideOperationInspectFailure,
  decideOperationRecovery,
  decideTaskGateRecovery,
  decideWorkspaceRecovery,
  decideWorkflowRecovery,
  persistRecoveryDecision,
  type ObservedExternalState,
  type RecoveryDecision
} from "./recovery-decision.js";
import { inspectWorkspaceRecovery, type WorkspaceGitRunner } from "./workspace-manager.js";
import { reconcilePullRequestRuntime, type PullRequestProvider } from "./pr-mr-provider.js";

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
  workspaceGitRunner?: WorkspaceGitRunner;
  pullRequestProvider?: PullRequestProvider;
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
    | "workspace_inspected"
    | "lock_reconciled"
    | "pr_reconciled"
    | "retry_blocked"
    | "reconcile_failed";
  taskId?: string;
  workflowRunId?: string;
  workspaceId?: string;
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

function reconcileActiveOperations(
  context: DbContext,
  tickId: string,
  now: Date,
  input: DaemonRuntimeInput,
  touchedWorkflowRunIds: Set<string>
): DaemonActionResult[] {
  const operations = listOperationsByStatusAndKindPrefix(context, ["running", "failed", "unknown"], "daemon:", input.candidateLimit ?? 5)
    .filter((operation) => !hasPersistedRecoveryDecision(operation.lastObservedState));
  const actions: DaemonActionResult[] = [];
  for (const operation of operations) {
    const task = operation.taskId ? getTask(context, operation.taskId) : undefined;
    const workflowRunId = workflowRunIdFromOperation(operation);
    if (workflowRunId) {
      touchedWorkflowRunIds.add(workflowRunId);
    }
    if (task && (task.status === "paused" || task.status === "canceled")) {
      const decision = decideTaskGateRecovery({
        task,
        resourceKind: "operation",
        resourceId: operation.id,
        operationId: operation.id,
        attemptId: operation.attemptId,
        reasonCode: `operation-replay-${task.status}-safe-inspect`,
        observedSummary: `operation replay skipped while task is ${task.status}`
      });
      persistRecoveryDecision(context, decision, {
        tickId,
        now,
        operationStatus: "unknown",
        severity: "debug"
      });
      actions.push({
        kind: "retry_blocked",
        taskId: operation.taskId,
        status: "skipped",
        summary: decision.observedSummary
      });
      continue;
    }
    const observation = observeDaemonOperationSafely(context, operation, input.workflowInspectRunner);
    if ("error" in observation) {
      const decision = decideOperationInspectFailure({ operation, error: observation.error });
      persistRecoveryDecision(context, decision, {
        tickId,
        now,
        operationStatus: "unknown",
        severity: "warn"
      });
      actions.push({
        kind: "reconcile_failed",
        taskId: operation.taskId,
        status: "failed",
        summary: decision.observedSummary
      });
      continue;
    }
    const observedExternalState = observation.observedExternalState;
    const decision = decideOperationRecovery({
      operation,
      observedExternalState,
      observedSummary: observation.observedSummary,
      retryAllowed: operation.kind !== "daemon:workflow:inspect" && task !== undefined && countTaskRetryEvents(context, task.id) < DEFAULT_RETRY_BACKOFF_MS.length
    });
    const retryOutcome = decision.kind === "retry" && operation.taskId
      ? persistOperationRetryDecision(context, operation, decision, now, tickId)
      : undefined;
    if (retryOutcome === undefined) {
      persistRecoveryDecision(context, decision, {
        tickId,
        now,
        operationStatus: operationStatusForDecision(decision),
        severity: decision.operatorAttentionRequired ? "warn" : "debug"
      });
    }
    actions.push({
      kind: decision.kind === "reconciled" ? "workflow_inspected" : "retry_blocked",
      taskId: operation.taskId,
      status: decision.kind === "operator_attention" || retryOutcome === "exhausted" ? "failed" : "skipped",
      summary: decision.observedSummary
    });
  }
  return actions;
}

function workflowRunIdFromOperation(operation: OperationRecord): string | undefined {
  if (operation.kind !== "daemon:workflow:inspect") {
    return undefined;
  }
  return isRecord(operation.lastObservedState) ? toOptionalString(operation.lastObservedState.workflowRunId) : undefined;
}

function observeDaemonOperationSafely(
  context: DbContext,
  operation: OperationRecord,
  runner: WorkflowProtocolRunner | undefined
): { observedExternalState: ObservedExternalState; observedSummary: string } | { error: Error } {
  try {
    return observeDaemonOperation(context, operation, runner);
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}

function observeDaemonOperation(
  context: DbContext,
  operation: { id: string; kind: string; lastObservedState?: unknown; status: string },
  runner: WorkflowProtocolRunner | undefined
): { observedExternalState: ObservedExternalState; observedSummary: string } {
  if (operation.kind === "daemon:workflow:inspect") {
    const workflowRunId = isRecord(operation.lastObservedState) ? toOptionalString(operation.lastObservedState.workflowRunId) : undefined;
    if (workflowRunId) {
      const inspected = inspectWorkflowRun(context, buildWorkflowInspectInput(workflowRunId, runner));
      return {
        observedExternalState: "matches-intent",
        observedSummary: `workflow run ${workflowRunId} inspected: ${inspected.status.summary ?? inspected.workflowRun.status}`
      };
    }
  }
  if (operation.kind === "daemon:agent:stale") {
    const agentSessionId = isRecord(operation.lastObservedState) ? toOptionalString(operation.lastObservedState.agentSessionId) : undefined;
    if (agentSessionId) {
      const inspected = inspectAgentSession(context, { agentSessionId });
      return {
        observedExternalState: "matches-intent",
        observedSummary: `agent session ${agentSessionId} inspected: ${inspected.session.status}`
      };
    }
  }
  const observedExternalState = observedStateFromOperation(operation);
  return {
    observedExternalState,
    observedSummary: summarizeOperationObservation(operation, observedExternalState)
  };
}

function observedStateFromOperation(operation: { lastObservedState?: unknown; status: string }): ObservedExternalState {
  const observed = operation.lastObservedState;
  if (isRecord(observed) && typeof observed.observedExternalState === "string") {
    const value = observed.observedExternalState;
    if (value === "absent" || value === "matches-intent" || value === "conflicts-with-intent" || value === "unclear") {
      return value;
    }
  }
  if (operation.status === "unknown") {
    return "unclear";
  }
  return "absent";
}

function summarizeOperationObservation(operation: { id: string; kind: string }, observedExternalState: ObservedExternalState): string {
  return `operation ${operation.kind}:${operation.id} observed ${observedExternalState}`;
}

function operationStatusForDecision(decision: RecoveryDecision): "reconciled" | "unknown" | undefined {
  if (decision.kind === "no_op") {
    return undefined;
  }
  if (decision.kind === "operator_attention" || decision.kind === "unknown") {
    return "unknown";
  }
  // retry 已经转换成新的 task retry schedule；这里封口旧 operation，避免同一 tick 事实被反复重放。
  return "reconciled";
}

function persistOperationRetryDecision(
  context: DbContext,
  operation: OperationRecord,
  decision: RecoveryDecision,
  now: Date,
  tickId: string
): "scheduled" | "exhausted" | "already-terminal" {
  return withTransaction(context, () => {
    const retryOutcome = scheduleTaskRetry(context, operation.taskId ?? "", now, tickId, `operation-replay:${operation.kind}`);
    persistRecoveryDecision(context, decision, {
      tickId,
      now,
      operationStatus: retryOutcome === "scheduled" ? "reconciled" : "unknown",
      severity: retryOutcome === "scheduled" ? "debug" : "warn"
    });
    return retryOutcome;
  });
}

export function runDaemonTick(context: DbContext, input: DaemonRuntimeInput = {}): DaemonTickResult {
  const tickId = randomUUID();
  const owner = normalizeOwner(input.owner ?? "daemon");
  const now = input.now ?? new Date();
  const actions: DaemonActionResult[] = [];
  const touchedTaskIds = new Set<string>();
  const touchedWorkflowRunIds = new Set<string>();

  appendEvent(context, {
    type: "daemon.tick_started",
    summary: `daemon tick started: ${tickId}`,
    payload: { tickId, owner },
    severity: "debug"
  });

  actions.push(...reconcileActiveOperations(context, tickId, now, input, touchedWorkflowRunIds));
  actions.push(...reconcileWorkspaces(context, tickId, input, touchedTaskIds));
  actions.push(...reconcileExpiredLocks(context, tickId, now, input));
  actions.push(...reconcilePullRequestOperations(context, tickId, input, touchedTaskIds));
  actions.push(...reconcileWorkflowActionOperations(context, tickId, input, touchedWorkflowRunIds, touchedTaskIds));
  actions.push(...watchActiveAgentSessions(context, tickId, owner, now));
  actions.push(...reconcileWorkflowRuns(context, tickId, owner, input, touchedWorkflowRunIds, touchedTaskIds));
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

function reconcileWorkspaces(
  context: DbContext,
  tickId: string,
  input: DaemonRuntimeInput,
  touchedTaskIds: Set<string>
): DaemonActionResult[] {
  const workspaces = listWorkspacesByStatus(context, ["creating", "ready", "dirty"], input.candidateLimit ?? 5);
  const actions: DaemonActionResult[] = [];
  for (const workspace of workspaces) {
    const observation = inspectWorkspaceRecovery(context, {
      workspaceId: workspace.id,
      gitRunner: input.workspaceGitRunner
    });
    const decision = decideWorkspaceRecovery({ workspace, observation });
    if (decision.kind === "no_op") {
      continue;
    }
    persistRecoveryDecision(context, decision, {
      tickId,
      severity: decision.operatorAttentionRequired ? "warn" : "debug",
      workspaceStatus: decision.operatorAttentionRequired ? { workspace, status: "blocked" } : undefined
    });
    touchedTaskIds.add(workspace.taskId);
    actions.push({
      kind: "workspace_inspected",
      taskId: workspace.taskId,
      workspaceId: workspace.id,
      status: "skipped",
      summary: decision.observedSummary
    });
  }
  return actions;
}

function reconcileExpiredLocks(context: DbContext, tickId: string, now: Date, input: DaemonRuntimeInput): DaemonActionResult[] {
  const locks = listExpiredLocks(context, now, input.candidateLimit ?? 5)
    .filter((lock) => (lock.resourceKind === "workspace" || lock.resourceKind === "pr-merge") && !isTerminalLockResource(lock.resourceKind, lock.resourceId));
  const actions: DaemonActionResult[] = [];
  for (const lock of locks) {
    const workspaceRecord = lock.resourceKind === "workspace" ? getWorkspace(context, lock.resourceId) : undefined;
    const workspaceObservation = workspaceRecord
      ? inspectWorkspaceRecovery(context, { workspaceId: workspaceRecord.id, gitRunner: input.workspaceGitRunner })
      : undefined;
    const decision = decideLockRecovery({
      lock,
      workspaceObservation,
      ownerActive: isLockOwnerActive(context, lock.resourceKind, lock.resourceId),
      now
    });
    let releaseSkipped = false;
    try {
      persistRecoveryDecision(context, decision, {
        tickId,
        severity: decision.operatorAttentionRequired ? "warn" : "debug",
        lockRelease: decision.nextAction === "release_expired_lock"
          ? {
              resourceKind: lock.resourceKind,
              resourceId: lock.resourceId,
              lockToken: lock.lockToken,
              leaseVersion: lock.leaseVersion
            }
          : undefined
      });
    } catch (error) {
      const currentLock = getLock(context, lock.resourceKind, lock.resourceId);
      appendEvent(context, {
        type: "daemon.recovery_decision",
        summary: `expired lock release skipped: ${lock.resourceKind}:${lock.resourceId}`,
        projectId: workspaceObservation?.projectId,
        taskId: workspaceObservation?.taskId,
        attemptId: workspaceObservation?.attemptId,
        severity: "debug",
        payload: {
          tickId,
          resourceKind: "lock",
        resourceId: `${lock.resourceKind}:${lock.resourceId}`,
        decision: "retry_blocked",
        reasonCode: currentLock && currentLock.leaseVersion !== lock.leaseVersion ? "lock-lease-changed" : "lock-release-skipped",
          observedSummary: errorSummaryFrom(error),
          nextAction: "none",
          operatorAttentionRequired: false,
          artifactRefs: workspaceObservation?.artifactRefs ?? []
        }
      });
      releaseSkipped = true;
    }
    actions.push({
      kind: decision.nextAction === "release_expired_lock" && !releaseSkipped ? "lock_reconciled" : "retry_blocked",
      taskId: workspaceObservation?.taskId,
      workspaceId: lock.resourceKind === "workspace" ? lock.resourceId : undefined,
      status: "skipped",
      summary: decision.observedSummary
    });
  }
  return actions;
}

function reconcilePullRequestOperations(
  context: DbContext,
  tickId: string,
  input: DaemonRuntimeInput,
  touchedTaskIds: Set<string>
): DaemonActionResult[] {
  if (!input.pullRequestProvider) {
    return [];
  }
  const operations = listOperationsByStatusAndKindPrefix(context, ["running", "failed", "unknown"], "merge", input.candidateLimit ?? 5)
    .filter((operation) => operation.kind === "merge" && operation.prId && !hasPersistedRecoveryDecision(operation.lastObservedState));
  const actions: DaemonActionResult[] = [];
  for (const operation of operations) {
    const pr = operation.taskId ? getLatestPullRequestByTask(context, operation.taskId) : undefined;
    if (!pr || pr.id !== operation.prId || !operation.taskId) {
      continue;
    }
    try {
      const result = reconcilePullRequestRuntime(context, {
        taskId: operation.taskId,
        prId: pr.id,
        operationId: operation.id,
        actor: "daemon",
        provider: input.pullRequestProvider,
        retryAllowed: countTaskRetryEvents(context, operation.taskId) < DEFAULT_RETRY_BACKOFF_MS.length
      });
      touchedTaskIds.add(operation.taskId);
      actions.push({
        kind: result.decisionKind === "reconciled" ? "pr_reconciled" : "retry_blocked",
        taskId: operation.taskId,
        status: result.decisionKind === "operator_attention" ? "failed" : "skipped",
        summary: `${result.reasonCode}: ${pr.id}`
      });
    } catch (error) {
      appendEvent(context, {
        type: "daemon.pr_reconcile_failed",
        summary: `daemon failed to reconcile PR/MR: ${pr.id}`,
        projectId: pr.projectId,
        taskId: pr.taskId,
        attemptId: pr.attemptId,
        prId: pr.id,
        operationId: operation.id,
        severity: "warn",
        payload: { tickId, error: errorSummaryFrom(error) }
      });
      actions.push({
        kind: "reconcile_failed",
        taskId: operation.taskId,
        status: "failed",
        summary: `PR/MR ${pr.id} reconcile failed`
      });
    }
  }
  return actions;
}

function reconcileWorkflowActionOperations(
  context: DbContext,
  tickId: string,
  input: DaemonRuntimeInput,
  touchedWorkflowRunIds: Set<string>,
  touchedTaskIds: Set<string>
): DaemonActionResult[] {
  const operations = listOperationsByStatusAndKindPrefix(context, ["running", "failed", "unknown"], "workflow:action", input.candidateLimit ?? 5)
    .filter((operation) => operation.kind === "workflow:action" && !hasPersistedRecoveryDecision(operation.lastObservedState));
  const actions: DaemonActionResult[] = [];
  const inspectedRuns = new Map<string, { observedSummary: string } | { error: Error }>();
  for (const operation of operations) {
    const run = workflowRunFromActionOperation(context, operation);
    if (!run) {
      const decision = decideOperationInspectFailure({
        operation,
        error: new WorkflowProtocolError("workflow action operation missing workflow run")
      });
      persistRecoveryDecision(context, decision, {
        tickId,
        operationStatus: "unknown",
        severity: "warn"
      });
      if (operation.taskId) {
        touchedTaskIds.add(operation.taskId);
      }
      actions.push({
        kind: "reconcile_failed",
        taskId: operation.taskId,
        status: "failed",
        summary: decision.observedSummary
      });
      continue;
    }

    touchedWorkflowRunIds.add(run.id);
    let observation = inspectedRuns.get(run.id);
    if (!observation) {
      // action 已可能产生外部副作用；恢复时只能 read-only inspect，不能直接重放 action。
      try {
        const inspected = inspectWorkflowRun(context, buildWorkflowInspectInput(run.id, input.workflowInspectRunner));
        observation = { observedSummary: `workflow action inspected: ${inspected.workflowRun.id}:${inspected.workflowRun.status}` };
      } catch (error) {
        observation = { error: error instanceof Error ? error : new Error(String(error)) };
      }
      inspectedRuns.set(run.id, observation);
    }
    if ("observedSummary" in observation) {
      const decision = decideOperationRecovery({
        operation,
        observedExternalState: "matches-intent",
        observedSummary: observation.observedSummary,
        retryAllowed: false
      });
      persistRecoveryDecision(context, decision, {
        tickId,
        operationStatus: operationStatusForDecision(decision),
        severity: decision.operatorAttentionRequired ? "warn" : "debug"
      });
      actions.push({
        kind: decision.kind === "reconciled" ? "workflow_inspected" : "retry_blocked",
        taskId: operation.taskId,
        workflowRunId: run.id,
        status: decision.operatorAttentionRequired ? "failed" : "skipped",
        summary: decision.observedSummary
      });
    } else {
      const decision = decideOperationInspectFailure({
        operation,
        error: observation.error
      });
      persistRecoveryDecision(context, decision, {
        tickId,
        operationStatus: "unknown",
        severity: "warn"
      });
      if (operation.taskId) {
        touchedTaskIds.add(operation.taskId);
      }
      actions.push({
        kind: "reconcile_failed",
        taskId: operation.taskId,
        workflowRunId: run.id,
        status: "failed",
        summary: decision.observedSummary
      });
    }
  }
  return actions;
}

function workflowRunFromActionOperation(context: DbContext, operation: OperationRecord): WorkflowRunRecord | undefined {
  const workflowRunId = isRecord(operation.lastObservedState) ? toOptionalString(operation.lastObservedState.workflowRunId) : undefined;
  if (workflowRunId) {
    return getWorkflowRun(context, workflowRunId);
  }
  if (operation.attemptId) {
    return getActiveWorkflowRunByAttempt(context, operation.attemptId);
  }
  return undefined;
}

function isLockOwnerActive(context: DbContext, resourceKind: string, resourceId: string): boolean {
  if (resourceKind !== "workspace") {
    if (resourceKind === "pr-merge") {
      return hasActiveOperationForPullRequest(context, resourceId);
    }
    return false;
  }
  const workspace = listWorkspacesByStatus(context, ["planned", "creating", "ready", "dirty"], 500).find((item) => item.id === resourceId);
  if (!workspace) {
    return false;
  }
  return Boolean(
    getActiveAgentSessionByTask(context, workspace.taskId, "outer") ||
    getActiveWorkflowRunByAttempt(context, workspace.attemptId) ||
    hasActiveOperationForWorkspace(context, workspace.taskId, workspace.attemptId)
  );
}

function hasActiveOperationForPullRequest(context: DbContext, prId: string): boolean {
  const row = context.db
    .prepare(
      `SELECT 1 FROM operations
       WHERE pr_id = ? AND status IN ('planned', 'running')
       LIMIT 1`
    )
    .get(prId);
  return Boolean(row);
}

function hasActiveOperationForWorkspace(context: DbContext, taskId: string, attemptId: string): boolean {
  const row = context.db
    .prepare(
      `SELECT 1 FROM operations
       WHERE status IN ('planned', 'running', 'unknown')
         AND (task_id = ? OR attempt_id = ?)
       LIMIT 1`
    )
    .get(taskId, attemptId);
  return Boolean(row);
}

function isTerminalLockResource(resourceKind: string, resourceId: string): boolean {
  return resourceKind.length === 0 || resourceId.length === 0;
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
  input: DaemonRuntimeInput,
  skippedWorkflowRunIds: Set<string>,
  touchedTaskIds: Set<string>
): DaemonActionResult[] {
  const runs = listWorkflowRunsByStatus(context, ["starting", "running", "blocked", "unknown"], input.candidateLimit ?? 5);
  const actions: DaemonActionResult[] = [];
  for (const run of runs) {
    if (skippedWorkflowRunIds.has(run.id)) {
      // operation replay 已在本 tick 触达该 workflow run，避免重复 inspect 和重复事件。
      continue;
    }
    const action = reconcileWorkflowRun(context, run, tickId, owner, input.workflowInspectRunner);
    if (action.status === "failed") {
      touchedTaskIds.add(run.taskId);
    }
    actions.push(action);
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
      lastObservedState: { tickId, owner, agentSessionId: row.id, ageMs, observedExternalState: "unclear" }
    });
    const inspected = inspectAgentSession(context, { agentSessionId: row.id });
    const task = row.task_id ? getTask(context, row.task_id) : undefined;
    const retryAllowed = task ? countTaskRetryEvents(context, task.id) < DEFAULT_RETRY_BACKOFF_MS.length : false;
    const decision = decideAgentSessionRecovery({
      session: {
        id: inspected.session.id,
        projectId: inspected.session.projectId,
        taskId: inspected.session.taskId,
        attemptId: inspected.session.attemptId,
        providerKind: inspected.session.providerKind,
        role: inspected.session.role,
        status: inspected.session.status,
        stateVersion: inspected.session.stateVersion
      },
      operationId: operation.id,
      ageMs,
      retryAllowed,
      task
    });
    withTransaction(context, () => {
      const retryOutcome = task && decision.kind === "retry" && !["waiting_human", "waiting_review", "waiting_merge_approval"].includes(task.status)
        ? scheduleTaskRetry(context, task.id, now, tickId, "stalled-agent-session")
        : undefined;
      persistRecoveryDecision(context, decision, {
        tickId,
        now,
        operationStatus: decision.kind === "operator_attention" || retryOutcome === "exhausted" || retryOutcome === "already-terminal" ? "unknown" : "reconciled",
        severity: decision.operatorAttentionRequired || retryOutcome === "exhausted" || retryOutcome === "already-terminal" ? "warn" : "debug"
      });
      appendEvent(context, {
        type: "daemon.agent_session_stalled",
        summary: `agent session stalled: ${row.id}`,
        projectId: row.project_id,
        taskId: row.task_id ?? undefined,
        attemptId: row.attempt_id ?? undefined,
        agentSessionId: row.id,
        operationId: operation.id,
        severity: decision.operatorAttentionRequired ? "warn" : "debug",
        payload: { tickId, ageMs, providerKind: row.provider_kind, role: row.role, decision: decision.kind, retryOutcome }
      });
      if (decision.nextAction === "stop_session") {
        // 只有 Core recovery decision 明确允许时才把 stale session 移出 active 集合。
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
      }
    });
    actions.push({
      kind: "reconcile_failed",
      taskId: row.task_id ?? undefined,
      agentSessionId: row.id,
      status: decision.kind === "operator_attention" ? "failed" : "skipped",
      summary: decision.observedSummary
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
    const decision = decideWorkflowRecovery({ workflowRun: run, operationId: operation.id, status: result.status });
    withTransaction(context, () => {
      persistRecoveryDecision(context, decision, {
        tickId,
        severity: "debug"
      });
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
    });
    return {
      kind: "workflow_inspected",
      taskId: run.taskId,
      workflowRunId: run.id,
      status: "succeeded",
      summary: `workflow run ${run.id} inspected`
    };
  } catch (error) {
    const decision = decideWorkflowRecovery({
      workflowRun: run,
      operationId: operation.id,
      error: error instanceof Error ? error : new Error(String(error))
    });
    withTransaction(context, () => {
      persistRecoveryDecision(context, decision, {
        tickId,
        operationStatus: "unknown",
        severity: decision.operatorAttentionRequired ? "warn" : "debug"
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
          error: errorSummaryFrom(error),
          invariant: "workflow 不可用时不能静默推进 completed"
        }
      });
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
    const decision = decideTaskGateRecovery({
      task: currentTask,
      resourceKind: "task_gate",
      resourceId: request.id,
      reasonCode: `human-answer-${currentTask.status}-safe-inspect`,
      observedSummary: `human answer is waiting while task is ${currentTask.status}`
    });
    persistRecoveryDecision(context, decision, { tickId, now, severity: "debug" });
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
    const errorSummary = errorSummaryFrom(error);
    updateOperation(context, {
      operationId: operation.id,
      status: "failed",
      now,
      failureCode: errorSummary,
      lastObservedState: { tickId, error: errorSummary }
    });
    appendEvent(context, {
      type: "daemon.human_wake_up_failed",
      summary: `daemon failed to wake task from human answer: ${request.taskId}`,
      projectId: request.projectId,
      taskId: request.taskId,
      attemptId: request.attemptId,
      operationId: operation.id,
      severity: "warn",
      payload: { tickId, error: errorSummary }
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
      const errorSummary = errorSummaryFrom(error);
      const retryOutcome = scheduleTaskRetry(context, task.id, now, tickId, errorSummary);
      appendEvent(context, {
        type: "daemon.advance_failed",
        summary: `daemon failed to advance task: ${task.id}`,
        projectId: task.projectId,
        taskId: task.id,
        severity: "warn",
        payload: { tickId, error: errorSummary, errorName: error.name, retryOutcome }
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
        summary: errorSummary
      };
    }
    throw error;
  }
}

function errorSummaryFrom(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "unknown";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasPersistedRecoveryDecision(value: unknown): boolean {
  return isRecord(value) && typeof value.decision === "string" && typeof value.reasonCode === "string";
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
