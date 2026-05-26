import { existsSync, readFileSync } from "node:fs";
import {
  getWorkflowRun,
  listAgentSessionsByTask,
  listTaskEvents,
  type AgentSessionRecord,
  type DbContext,
  type EventRecord,
  type WorkflowRunRecord
} from "@coordinator/db";
import { deriveWorkflowRuntimeObservation } from "@coordinator/shared";

export type WorkflowGateEvidenceStatus = "ready" | "partial" | "missing";

export type WorkflowGateEvidenceMessage = {
  source: "inner-agent-final-response";
  agentSessionId: string;
  providerKind: string;
  status: string;
  text: string;
  artifactPath?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type WorkflowGateEvidenceProtocolFacts = {
  profile?: string;
  lifecycle?: string;
  stage?: string;
  substate?: string;
  progressLabel?: string;
  progressSummary?: string;
  handoffKind?: string;
  handoffAvailable: boolean;
  allowedActions: string[];
  operatorActions: string[];
  agentInternalActions: string[];
  debugOnlyActions: string[];
  deniedActions: string[];
  stageArtifacts: Array<{ kind?: string; path: string; label?: string; requiredForHandoff?: boolean }>;
};

export type WorkflowGateEvidence = {
  workflowRunId: string;
  taskId: string;
  attemptId: string;
  workflowRunStateVersion: number;
  evidenceStatus: WorkflowGateEvidenceStatus;
  canSubmit: boolean;
  primaryAction?: string;
  actionIds: string[];
  primaryMessage?: WorkflowGateEvidenceMessage;
  recentMessages: WorkflowGateEvidenceMessage[];
  protocolFacts: WorkflowGateEvidenceProtocolFacts;
  supportingArtifacts: string[];
  warnings: string[];
};

export type WorkflowGateEvidenceStatusOverride = {
  profile?: string;
  lifecycle?: string;
  stage?: string;
  substate?: string;
  progressLabel?: string;
  progressSummary?: string;
  handoffKind?: string;
  handoffAvailable?: boolean;
  allowedActions?: string[];
  deniedActions?: string[];
  actionInputHints?: Record<string, { requiredArgs?: string[]; usage?: string }>;
  stageArtifacts?: Array<{ kind?: string; path: string; label?: string; requiredForHandoff?: boolean }>;
  summary?: string;
};

export type BuildWorkflowGateEvidenceInput = {
  workflowRunId: string;
  action?: string;
  statusOverride?: WorkflowGateEvidenceStatusOverride;
};

const MAX_EVIDENCE_TEXT_LENGTH = 2400;
const MAX_RECENT_MESSAGES = 3;

export class WorkflowGateEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowGateEvidenceError";
  }
}

export function buildWorkflowGateEvidence(
  context: DbContext,
  input: BuildWorkflowGateEvidenceInput
): WorkflowGateEvidence {
  const workflowRun = getWorkflowRun(context, input.workflowRunId);
  if (!workflowRun) {
    throw new WorkflowGateEvidenceError(`workflow run not found: ${input.workflowRunId}`);
  }
  const events = listTaskEvents(context, workflowRun.taskId);
  const protocolFacts = buildProtocolFacts(workflowRun, events, input.statusOverride);
  const actionIds = input.action ? [input.action] : protocolFacts.operatorActions;
  const primaryAction = input.action ?? actionIds[0];
  const warnings: string[] = [];

  if (primaryAction && !protocolFacts.operatorActions.includes(primaryAction)) {
    warnings.push(`workflow action ${primaryAction} is not an operator-facing gate in latest evidence`);
  }

  const evidenceMessages = collectInnerAgentVisibleMessages(context, workflowRun, events);
  if (evidenceMessages.messages.length === 0) {
    warnings.push("缺少 inner coding agent 通过 SDK 返回的可见确认依据，不能盲确认 workflow gate。");
  }
  if (evidenceMessages.excludedStaleCount > 0) {
    warnings.push("已忽略早于最近 workflow action 的 inner agent 输出，当前 gate 需要新的可见确认依据。");
  }

  const primaryMessage = evidenceMessages.messages[0];
  const hasOperatorAction = Boolean(primaryAction && protocolFacts.operatorActions.includes(primaryAction));
  const evidenceStatus: WorkflowGateEvidenceStatus = primaryMessage
    ? isReadyAgentSessionStatus(primaryMessage.status)
      ? "ready"
      : "partial"
    : "missing";
  const canSubmit = evidenceStatus === "ready" && hasOperatorAction;
  if (evidenceStatus === "partial") {
    warnings.push("inner coding agent evidence 不是 completed/stalled 状态，需要 operator 先检查。");
  }

  return {
    workflowRunId: workflowRun.id,
    taskId: workflowRun.taskId,
    attemptId: workflowRun.attemptId,
    workflowRunStateVersion: workflowRun.stateVersion,
    evidenceStatus,
    canSubmit,
    primaryAction,
    actionIds,
    primaryMessage,
    recentMessages: evidenceMessages.messages.slice(0, MAX_RECENT_MESSAGES),
    protocolFacts,
    supportingArtifacts: uniqueStrings([
      ...evidenceMessages.messages.flatMap((message) => (message.artifactPath ? [message.artifactPath] : [])),
      ...protocolFacts.stageArtifacts.map((artifact) => artifact.path)
    ]),
    warnings
  };
}

export function assertWorkflowGateEvidenceCanSubmit(evidence: WorkflowGateEvidence, action: string): void {
  if (!evidence.canSubmit || evidence.primaryAction !== action) {
    throw new WorkflowGateEvidenceError(
      `workflow action ${action} 缺少 coding agent 可见确认依据，不能盲确认 workflow gate`
    );
  }
}

function buildProtocolFacts(
  workflowRun: WorkflowRunRecord,
  events: EventRecord[],
  override: WorkflowGateEvidenceStatusOverride | undefined
): WorkflowGateEvidenceProtocolFacts {
  const projection = override ?? findLatestWorkflowProjection(workflowRun.id, events);
  const observation = deriveWorkflowRuntimeObservation({
    lifecycle: projection?.lifecycle,
    status: workflowRun.status,
    handoffKind: workflowRun.handoffKind ?? projection?.handoffKind,
    handoffAvailable: projection?.handoffAvailable,
    allowedActions: projection?.allowedActions,
    deniedActions: projection?.deniedActions,
    actionInputHints: projection?.actionInputHints,
    summary: projection?.summary
  });

  return {
    profile: projection?.profile ?? workflowRun.profileId,
    lifecycle: projection?.lifecycle ?? workflowRun.status,
    stage: projection?.stage,
    substate: projection?.substate,
    progressLabel: projection?.progressLabel,
    progressSummary: projection?.progressSummary ?? projection?.summary,
    handoffKind: workflowRun.handoffKind ?? projection?.handoffKind,
    handoffAvailable: Boolean(workflowRun.handoffKind ?? projection?.handoffAvailable),
    allowedActions: uniqueStrings(projection?.allowedActions ?? []),
    operatorActions: observation.operatorActions,
    agentInternalActions: observation.agentInternalActions,
    debugOnlyActions: observation.debugOnlyActions,
    deniedActions: observation.deniedActions,
    stageArtifacts: projection?.stageArtifacts ?? []
  };
}

function collectInnerAgentVisibleMessages(
  context: DbContext,
  workflowRun: WorkflowRunRecord,
  events: EventRecord[]
): { messages: WorkflowGateEvidenceMessage[]; excludedStaleCount: number } {
  const lastWorkflowActionAt = findLastWorkflowActionAt(workflowRun.id, events);
  const allMessages = listAgentSessionsByTask(context, workflowRun.taskId, 20)
    .filter((session) => session.role === "inner" && session.attemptId === workflowRun.attemptId)
    .map(readVisibleMessage)
    .filter((message): message is WorkflowGateEvidenceMessage => Boolean(message));
  const messages = allMessages.filter((message) => isMessageAfterWorkflowActionBoundary(message, lastWorkflowActionAt));
  return { messages, excludedStaleCount: allMessages.length - messages.length };
}

function readVisibleMessage(session: AgentSessionRecord): WorkflowGateEvidenceMessage | undefined {
  if (!session.finalResponsePath || !existsSync(session.finalResponsePath)) {
    return undefined;
  }
  const text = truncate(readFileSync(session.finalResponsePath, "utf8").trim(), MAX_EVIDENCE_TEXT_LENGTH);
  if (!text) {
    return undefined;
  }
  return {
    source: "inner-agent-final-response",
    agentSessionId: session.id,
    providerKind: session.providerKind,
    status: session.status,
    text,
    artifactPath: session.finalResponsePath,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  };
}

function isReadyAgentSessionStatus(status: string): boolean {
  // 只有正常结束或主动停止后的可见输出才足以支持 human gate；stalled 仍可能是中途阻塞态。
  return status === "completed" || status === "stopped";
}

function findLastWorkflowActionAt(workflowRunId: string, events: EventRecord[]): string | undefined {
  for (const event of [...events].reverse()) {
    if (event.workflowRunId === workflowRunId && event.type === "workflow.action") {
      return event.createdAt;
    }
  }
  return undefined;
}

function isMessageAfterWorkflowActionBoundary(message: WorkflowGateEvidenceMessage, boundary: string | undefined): boolean {
  if (!boundary) {
    return true;
  }
  const messageTimestamp = message.updatedAt ?? message.createdAt;
  if (!messageTimestamp) {
    return false;
  }
  // 用最近 workflow action 作为 gate 分界，避免上一轮 gate 的 final response 误确认下一轮 gate。
  return toComparableTimestamp(messageTimestamp) >= toComparableTimestamp(boundary);
}

function findLatestWorkflowProjection(
  workflowRunId: string,
  events: EventRecord[]
): WorkflowGateEvidenceStatusOverride | undefined {
  for (const event of [...events].reverse()) {
    if (event.workflowRunId !== workflowRunId) {
      continue;
    }
    if (event.type !== "workflow.status_inspected" && event.type !== "workflow.started" && event.type !== "workflow.action") {
      continue;
    }
    const projection = workflowProjectionFromPayload(event.payload);
    if (projection) {
      return projection;
    }
  }
  return undefined;
}

function workflowProjectionFromPayload(payload: unknown): WorkflowGateEvidenceStatusOverride | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const debug = isRecord(payload.debug) ? payload.debug : undefined;
  const handoff = isRecord(payload.handoff) ? payload.handoff : undefined;
  const progress = isRecord(payload.progress) ? payload.progress : undefined;
  return {
    profile: readString(payload.profile),
    lifecycle: readString(payload.lifecycle),
    stage: readString(debug?.stage),
    substate: readString(debug?.substate),
    progressLabel: readString(progress?.label),
    progressSummary: readString(progress?.summary) ?? readString(payload.summary),
    handoffAvailable: readBoolean(handoff?.available),
    handoffKind: readString(handoff?.kind),
    allowedActions: readStringArray(debug?.allowedActions),
    deniedActions: [...readStringArray(debug?.deniedActions), ...readStringArray(handoff?.deniedActions)],
    actionInputHints: readActionInputHints(payload.actionInputHints),
    stageArtifacts: readStageArtifacts(payload.stageArtifacts),
    summary: readString(payload.summary)
  };
}

function readActionInputHints(value: unknown): WorkflowGateEvidenceStatusOverride["actionInputHints"] {
  if (!isRecord(value)) {
    return {};
  }
  const hints: WorkflowGateEvidenceStatusOverride["actionInputHints"] = {};
  for (const [actionId, rawHint] of Object.entries(value)) {
    if (!isRecord(rawHint)) {
      continue;
    }
    hints[actionId] = {
      requiredArgs: readStringArray(rawHint.requiredArgs),
      usage: readString(rawHint.usage)
    };
  }
  return hints;
}

function readStageArtifacts(value: unknown): WorkflowGateEvidenceProtocolFacts["stageArtifacts"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const path = readString(item.path);
    if (!path) {
      return [];
    }
    return [
      {
        kind: readString(item.kind),
        path,
        label: readString(item.label),
        requiredForHandoff: readBoolean(item.requiredForHandoff)
      }
    ];
  });
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function toComparableTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
