import {
  appendEvent,
  releaseLockIfVersion,
  updateOperation,
  updateTaskStatus,
  updateWorkflowRun,
  withTransaction,
  type AgentSessionRecord,
  type DbContext,
  type LockRecord,
  type OperationRecord,
  type TaskRecord,
  type WorkspaceRecord,
  type WorkflowRunRecord
} from "@coordinator/db";
import type { WorkspaceRecoveryObservation } from "./workspace-manager.js";
import type { WorkflowStatus } from "./workflow-protocol-adapter.js";

export type RecoveryResourceKind = "operation" | "workflow_run" | "agent_session" | "task_gate" | "workspace" | "lock";

export type ObservedExternalState = "absent" | "matches-intent" | "conflicts-with-intent" | "unclear";

export type RecoveryDecisionKind =
  | "no_op"
  | "retry"
  | "retry_blocked"
  | "reconciled"
  | "unknown"
  | "operator_attention"
  | "safe_inspect_only";

export type RecoveryNextAction =
  | "none"
  | "retry_later"
  | "inspect_again"
  | "mark_reconciled"
  | "mark_unknown"
  | "stop_session"
  | "release_expired_lock"
  | "operator_review";

export type RecoveryDecision = {
  kind: RecoveryDecisionKind;
  resourceKind: RecoveryResourceKind;
  resourceId: string;
  operationId?: string;
  taskId?: string;
  projectId?: string;
  attemptId?: string;
  reasonCode: string;
  observedSummary: string;
  nextAction: RecoveryNextAction;
  retryDueAt?: string;
  operatorAttentionRequired?: boolean;
  artifactRefs?: string[];
};

export type OperationRecoveryObservation = {
  operation: OperationRecord;
  observedExternalState: ObservedExternalState;
  observedSummary: string;
  retryAllowed: boolean;
};

export type WorkflowRecoveryObservation = {
  workflowRun: WorkflowRunRecord;
  operationId?: string;
  status?: WorkflowStatus;
  error?: Error;
};

export type AgentSessionRecoveryObservation = {
  session: AgentSessionRecord;
  operationId: string;
  ageMs: number;
  retryAllowed: boolean;
  task?: TaskRecord;
  sameSnapshotAlreadyProcessed?: boolean;
};

export type TaskGateRecoveryObservation = {
  task: TaskRecord;
  resourceKind: RecoveryResourceKind;
  resourceId: string;
  operationId?: string;
  attemptId?: string;
  reasonCode: string;
  observedSummary: string;
};

export type WorkspaceRecoveryDecisionObservation = {
  workspace: WorkspaceRecord;
  observation: WorkspaceRecoveryObservation;
};

export type LockRecoveryObservation = {
  lock: LockRecord;
  workspaceObservation?: WorkspaceRecoveryObservation;
  ownerActive: boolean;
  now: Date;
};

export function decideOperationRecovery(input: OperationRecoveryObservation): RecoveryDecision {
  const operation = input.operation;
  const base = decisionBase("operation", operation.id, operation, input.observedSummary);

  if (operation.status === "running" && input.observedExternalState === "matches-intent") {
    return { ...base, kind: "reconciled", reasonCode: "operation-matches-intent", nextAction: "mark_reconciled" };
  }
  if (operation.status === "running" && input.observedExternalState === "absent") {
    return input.retryAllowed
      ? { ...base, kind: "retry", reasonCode: "operation-absent-retryable", nextAction: "retry_later" }
      : {
          ...base,
          kind: "operator_attention",
          reasonCode: "operation-absent-retry-exhausted",
          nextAction: "operator_review",
          operatorAttentionRequired: true
        };
  }
  if (operation.status === "running" && input.observedExternalState === "conflicts-with-intent") {
    return {
      ...base,
      kind: "operator_attention",
      reasonCode: "operation-conflicts-with-intent",
      nextAction: "operator_review",
      operatorAttentionRequired: true
    };
  }
  if (operation.status === "failed" && input.observedExternalState === "matches-intent") {
    return { ...base, kind: "reconciled", reasonCode: "failed-operation-external-matches", nextAction: "mark_reconciled" };
  }
  if (operation.status === "failed" && input.observedExternalState === "absent" && input.retryAllowed) {
    return { ...base, kind: "retry", reasonCode: "failed-operation-absent-retryable", nextAction: "retry_later" };
  }
  if (operation.status === "unknown" && input.observedExternalState === "matches-intent") {
    return { ...base, kind: "reconciled", reasonCode: "unknown-operation-external-matches", nextAction: "mark_reconciled" };
  }
  if (operation.status === "unknown" && input.observedExternalState === "conflicts-with-intent") {
    return {
      ...base,
      kind: "operator_attention",
      reasonCode: "unknown-operation-conflicts-with-intent",
      nextAction: "operator_review",
      operatorAttentionRequired: true
    };
  }
  if (operation.status === "unknown") {
    return {
      ...base,
      kind: "operator_attention",
      reasonCode: "unknown-operation-inspect-unclear",
      nextAction: "operator_review",
      operatorAttentionRequired: true
    };
  }

  return { ...base, kind: "unknown", reasonCode: "operation-observation-unclear", nextAction: "inspect_again" };
}

export function decideOperationInspectFailure(input: { operation: OperationRecord; error: Error }): RecoveryDecision {
  const base = decisionBase("operation", input.operation.id, input.operation, sanitizedErrorSummary(input.error, "operation inspect failed"));
  return {
    ...base,
    kind: "operator_attention",
    reasonCode: "operation-inspect-failed",
    nextAction: "operator_review",
    operatorAttentionRequired: true
  };
}

export function decideWorkflowRecovery(input: WorkflowRecoveryObservation): RecoveryDecision {
  const run = input.workflowRun;
  const base = decisionBase("workflow_run", run.id, {
    id: input.operationId,
    projectId: run.projectId,
    taskId: run.taskId,
    attemptId: run.attemptId
  }, input.error ? sanitizedWorkflowErrorSummary(input.error) : input.status?.summary ?? `workflow status observed: ${run.id}`);

  if (input.error) {
    if (input.error.message.includes("runId mismatch")) {
      return {
        ...base,
        kind: "operator_attention",
        reasonCode: "workflow-run-id-mismatch",
        observedSummary: "workflow protocol runId mismatch",
        nextAction: "operator_review",
        operatorAttentionRequired: true
      };
    }
    if (input.error.message.includes("profile mismatch")) {
      return {
        ...base,
        kind: "operator_attention",
        reasonCode: "workflow-profile-mismatch",
        observedSummary: "workflow protocol profile mismatch",
        nextAction: "operator_review",
        operatorAttentionRequired: true
      };
    }
    return { ...base, kind: "unknown", reasonCode: "workflow-protocol-unavailable", nextAction: "inspect_again" };
  }
  if (!input.status) {
    return { ...base, kind: "unknown", reasonCode: "workflow-status-missing", nextAction: "inspect_again" };
  }
  if (input.status.runId !== run.externalId) {
    return {
      ...base,
      kind: "operator_attention",
      reasonCode: "workflow-run-id-mismatch",
      observedSummary: "workflow protocol runId mismatch",
      nextAction: "operator_review",
      operatorAttentionRequired: true
    };
  }
  if (input.status.profile && input.status.profile !== run.profileId) {
    return {
      ...base,
      kind: "operator_attention",
      reasonCode: "workflow-profile-mismatch",
      observedSummary: "workflow protocol profile mismatch",
      nextAction: "operator_review",
      operatorAttentionRequired: true
    };
  }
  return { ...base, kind: "no_op", reasonCode: "workflow-status-consistent", nextAction: "none" };
}

export function decideAgentSessionRecovery(input: AgentSessionRecoveryObservation): RecoveryDecision {
  const session = input.session;
  const base = decisionBase("agent_session", session.id, {
    id: input.operationId,
    projectId: session.projectId,
    taskId: session.taskId,
    attemptId: session.attemptId
  }, `agent session stalled: ${session.id}`);

  if (input.task && (input.task.status === "paused" || input.task.status === "canceled")) {
    return {
      ...base,
      kind: "safe_inspect_only",
      reasonCode: `task-${input.task.status}-safe-inspect`,
      nextAction: "stop_session"
    };
  }
  if (input.task && ["waiting_human", "waiting_review", "waiting_merge_approval"].includes(input.task.status)) {
    return {
      ...base,
      kind: "safe_inspect_only",
      reasonCode: `task-${input.task.status}-safe-inspect`,
      nextAction: "stop_session"
    };
  }
  if (input.sameSnapshotAlreadyProcessed) {
    return {
      ...base,
      kind: "retry_blocked",
      reasonCode: "same-task-version-no-progress",
      nextAction: "none"
    };
  }
  if (!input.retryAllowed) {
    return {
      ...base,
      kind: "operator_attention",
      reasonCode: "agent-session-retry-exhausted",
      nextAction: "stop_session",
      operatorAttentionRequired: true
    };
  }
  return { ...base, kind: "retry", reasonCode: "agent-session-stalled", nextAction: "stop_session" };
}

export function decideTaskGateRecovery(input: TaskGateRecoveryObservation): RecoveryDecision {
  return {
    kind: "safe_inspect_only",
    resourceKind: input.resourceKind,
    resourceId: input.resourceId,
    operationId: input.operationId,
    taskId: input.task.id,
    projectId: input.task.projectId,
    attemptId: input.attemptId,
    reasonCode: input.reasonCode,
    observedSummary: input.observedSummary,
    nextAction: "none"
  };
}

export function decideWorkspaceRecovery(input: WorkspaceRecoveryDecisionObservation): RecoveryDecision {
  const workspace = input.workspace;
  const observation = input.observation;
  const base = decisionBase("workspace", workspace.id, {
    projectId: workspace.projectId,
    taskId: workspace.taskId,
    attemptId: workspace.attemptId
  }, observation.observedSummary);

  if (observation.kind === "safe") {
    return {
      ...base,
      kind: "no_op",
      reasonCode: "workspace-observation-safe",
      nextAction: "none",
      artifactRefs: observation.artifactRefs
    };
  }

  return {
    ...base,
    kind: "operator_attention",
    reasonCode: `workspace-${observation.kind}`,
    nextAction: "operator_review",
    operatorAttentionRequired: true,
    artifactRefs: observation.artifactRefs
  };
}

export function decideLockRecovery(input: LockRecoveryObservation): RecoveryDecision {
  const lock = input.lock;
  const expired = Date.parse(lock.expiresAt) <= input.now.getTime();
  const workspaceObservation = input.workspaceObservation;
  const observedSummary = [
    `lock ${lock.resourceKind}:${lock.resourceId} ${expired ? "expired" : "active"}`,
    input.ownerActive ? "owner active" : "owner inactive",
    workspaceObservation ? `workspace ${workspaceObservation.kind}` : undefined
  ].filter(Boolean).join("; ");

  const base = decisionBase("lock", `${lock.resourceKind}:${lock.resourceId}`, {
    projectId: workspaceObservation?.projectId,
    taskId: workspaceObservation?.taskId,
    attemptId: workspaceObservation?.attemptId
  }, observedSummary);

  if (!expired) {
    return { ...base, kind: "no_op", reasonCode: "lock-not-expired", nextAction: "none" };
  }
  if (input.ownerActive) {
    return {
      ...base,
      kind: "operator_attention",
      reasonCode: "expired-lock-owner-active",
      nextAction: "operator_review",
      operatorAttentionRequired: true,
      artifactRefs: workspaceObservation?.artifactRefs ?? []
    };
  }
  if (lock.resourceKind !== "workspace" || !workspaceObservation || !workspaceObservation.safeToReleaseLock) {
    return {
      ...base,
      kind: "operator_attention",
      reasonCode: "expired-lock-resource-unsafe",
      nextAction: "operator_review",
      operatorAttentionRequired: true,
      artifactRefs: workspaceObservation?.artifactRefs ?? []
    };
  }

  return {
    ...base,
    kind: "reconciled",
    reasonCode: "expired-lock-safe-to-release",
    nextAction: "release_expired_lock",
    artifactRefs: workspaceObservation.artifactRefs
  };
}

export function persistRecoveryDecision(
  context: DbContext,
  decision: RecoveryDecision,
  options: {
    tickId: string;
    now?: Date;
    operationStatus?: "succeeded" | "failed" | "unknown" | "reconciled" | "canceled";
    workflowRunStatus?: { workflowRun: WorkflowRunRecord; status: string };
    workspaceStatus?: { workspace: WorkspaceRecord; status: string };
    taskStatus?: { task: TaskRecord; status: string };
    severity?: "debug" | "info" | "warn" | "error";
    lockRelease?: { resourceKind: string; resourceId: string; lockToken: string; leaseVersion: number };
  }
): void {
  withTransaction(context, () => {
    if (options.lockRelease) {
      const released = releaseLockIfVersion(context, options.lockRelease);
      if (!released) {
        throw new Error(`lock lease changed: ${options.lockRelease.resourceKind}:${options.lockRelease.resourceId}`);
      }
    }
    if (decision.operationId && options.operationStatus) {
      updateOperation(context, {
        operationId: decision.operationId,
        status: options.operationStatus,
        now: options.now,
        lastObservedState: recoveryEventPayload(decision, options.tickId)
      });
    }
    if (options.workflowRunStatus) {
      updateWorkflowRun(context, {
        workflowRunId: options.workflowRunStatus.workflowRun.id,
        expectedStateVersion: options.workflowRunStatus.workflowRun.stateVersion,
        status: options.workflowRunStatus.status
      });
    }
    if (options.workspaceStatus) {
      updateWorkspaceRecoveryStatus(context, options.workspaceStatus.workspace, options.workspaceStatus.status);
    }
    if (options.taskStatus) {
      updateTaskStatus(
        context,
        options.taskStatus.task.id,
        options.taskStatus.task.stateVersion,
        options.taskStatus.status
      );
    }
    appendEvent(context, {
      type: "daemon.recovery_decision",
      summary: `${decision.reasonCode}: ${decision.resourceKind}:${decision.resourceId}`,
      projectId: decision.projectId,
      taskId: decision.taskId,
      attemptId: decision.attemptId,
      operationId: decision.operationId,
      workspaceId: decision.resourceKind === "workspace" ? decision.resourceId : undefined,
      workflowRunId: decision.resourceKind === "workflow_run" ? decision.resourceId : undefined,
      agentSessionId: decision.resourceKind === "agent_session" ? decision.resourceId : undefined,
      severity: options.severity ?? (decision.operatorAttentionRequired ? "warn" : "info"),
      payload: recoveryEventPayload(decision, options.tickId)
    });
  });
}

function updateWorkspaceRecoveryStatus(context: DbContext, workspace: WorkspaceRecord, status: string): void {
  const result = context.db
    .prepare(
      `UPDATE workspaces
       SET status = ?, state_version = state_version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND state_version = ?`
    )
    .run(status, workspace.id, workspace.stateVersion);
  if (result.changes === 0) {
    throw new Error(`workspace ${workspace.id} state_version mismatch`);
  }
}

function decisionBase(
  resourceKind: RecoveryResourceKind,
  resourceId: string,
  operationLike: { id?: string; projectId?: string; taskId?: string; attemptId?: string },
  observedSummary: string
): Omit<RecoveryDecision, "kind" | "reasonCode" | "nextAction"> {
  return {
    resourceKind,
    resourceId,
    operationId: operationLike.id,
    projectId: operationLike.projectId,
    taskId: operationLike.taskId,
    attemptId: operationLike.attemptId,
    observedSummary
  };
}

function recoveryEventPayload(decision: RecoveryDecision, tickId: string): Record<string, unknown> {
  return {
    tickId,
    resourceKind: decision.resourceKind,
    resourceId: decision.resourceId,
    operationId: decision.operationId,
    decision: decision.kind,
    reasonCode: decision.reasonCode,
    observedSummary: decision.observedSummary,
    nextAction: decision.nextAction,
    retryDueAt: decision.retryDueAt,
    operatorAttentionRequired: decision.operatorAttentionRequired === true,
    artifactRefs: decision.artifactRefs ?? []
  };
}

function sanitizedWorkflowErrorSummary(error: Error): string {
  if (error.message.includes("runId mismatch")) {
    return "workflow protocol runId mismatch";
  }
  if (error.message.includes("profile mismatch")) {
    return "workflow protocol profile mismatch";
  }
  return sanitizedErrorSummary(error, "workflow protocol unavailable");
}

function sanitizedErrorSummary(error: Error, fallback: string): string {
  const name = error.name && error.name !== "Error" ? error.name : undefined;
  return name ? `${fallback}: ${name}` : fallback;
}
