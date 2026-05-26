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
  eventId: number;
  workflowRunId: string;
  providerKind: string;
  status: string;
  text: string;
  artifactPath?: string;
  createdAt?: string;
  updatedAt?: string;
  eventCreatedAt?: string;
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
  if (evidenceMessages.excludedUnboundCount > 0) {
    warnings.push("已忽略未绑定当前 workflow run lifecycle event 的 inner agent 输出。");
  }
  if (evidenceMessages.excludedEmptyCount > 0) {
    warnings.push("已忽略 provider 空 final response 占位文本，当前 gate 需要 coding agent 可见确认依据。");
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
): { messages: WorkflowGateEvidenceMessage[]; excludedStaleCount: number; excludedUnboundCount: number; excludedEmptyCount: number } {
  const lastWorkflowActionEventId = findLastWorkflowActionEventId(workflowRun.id, events);
  const sessionEvents = collectWorkflowBoundSessionEvents(workflowRun.id, events);
  let excludedUnboundCount = 0;
  let excludedEmptyCount = 0;
  const allMessages = listAgentSessionsByTask(context, workflowRun.taskId, 20)
    .filter((session) => session.role === "inner" && session.attemptId === workflowRun.attemptId)
    .flatMap((session) => {
      const text = readVisibleMessageText(session);
      if (text.kind === "missing") {
        return [];
      }
      if (text.kind === "empty-placeholder") {
        excludedEmptyCount += 1;
        return [];
      }
      const event = selectWorkflowBoundSessionEvent(session, sessionEvents.get(session.id));
      if (!event) {
        excludedUnboundCount += 1;
        return [];
      }
      return [buildVisibleMessage(session, event, text.text)];
    });
  const messages = allMessages.filter((message) => isMessageAfterWorkflowActionBoundary(message, lastWorkflowActionEventId));
  return {
    messages,
    excludedStaleCount: allMessages.length - messages.length,
    excludedUnboundCount,
    excludedEmptyCount
  };
}

type SessionMessageText =
  | { kind: "available"; text: string }
  | { kind: "missing" }
  | { kind: "empty-placeholder" };

type WorkflowBoundSessionEvents = {
  latest?: EventRecord;
  completed?: EventRecord;
};

function readVisibleMessageText(session: AgentSessionRecord): SessionMessageText {
  if (!session.finalResponsePath || !existsSync(session.finalResponsePath)) {
    return { kind: "missing" };
  }
  const text = truncate(readFileSync(session.finalResponsePath, "utf8").trim(), MAX_EVIDENCE_TEXT_LENGTH);
  if (!text) {
    return { kind: "empty-placeholder" };
  }
  if (isEmptyProviderFinalResponsePlaceholder(text)) {
    return { kind: "empty-placeholder" };
  }
  return { kind: "available", text };
}

function buildVisibleMessage(
  session: AgentSessionRecord,
  event: EventRecord,
  text: string
): WorkflowGateEvidenceMessage {
  return {
    source: "inner-agent-final-response",
    agentSessionId: session.id,
    eventId: event.id,
    workflowRunId: event.workflowRunId!,
    providerKind: session.providerKind,
    status: session.status,
    text,
    artifactPath: session.finalResponsePath,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    eventCreatedAt: event.createdAt
  };
}

function isReadyAgentSessionStatus(status: string): boolean {
  // 只有正常结束或主动停止后的可见输出才足以支持 human gate；stalled 仍可能是中途阻塞态。
  return status === "completed" || status === "stopped";
}

function collectWorkflowBoundSessionEvents(workflowRunId: string, events: EventRecord[]): Map<string, WorkflowBoundSessionEvents> {
  const result = new Map<string, WorkflowBoundSessionEvents>();
  for (const event of events) {
    if (event.workflowRunId !== workflowRunId || !event.agentSessionId || !isWorkflowBoundAgentSessionEvent(event.type)) {
      continue;
    }
    const item = result.get(event.agentSessionId) ?? {};
    item.latest = event;
    if (event.type === "agent.session_completed") {
      item.completed = event;
    }
    result.set(event.agentSessionId, item);
  }
  return result;
}

function isWorkflowBoundAgentSessionEvent(type: string): boolean {
  return type === "agent.session_started" || type === "agent.session_completed" || type === "agent.session_failed";
}

function selectWorkflowBoundSessionEvent(
  session: AgentSessionRecord,
  events: WorkflowBoundSessionEvents | undefined
): EventRecord | undefined {
  // ready evidence 必须来自当前 workflow run 的 terminal event；仅靠 session timestamp 会被同秒 action 污染。
  return isReadyAgentSessionStatus(session.status) ? events?.completed : events?.latest;
}

function isEmptyProviderFinalResponsePlaceholder(text: string): boolean {
  return text.trim() === "provider returned empty response";
}

function findLastWorkflowActionEventId(workflowRunId: string, events: EventRecord[]): number | undefined {
  for (const event of [...events].reverse()) {
    if (event.workflowRunId === workflowRunId && event.type === "workflow.action") {
      return event.id;
    }
  }
  return undefined;
}

function isMessageAfterWorkflowActionBoundary(message: WorkflowGateEvidenceMessage, boundaryEventId: number | undefined): boolean {
  if (boundaryEventId === undefined) {
    return true;
  }
  // event id 是 append-only 严格序；比 timestamp 更适合作为 workflow action boundary。
  return message.eventId > boundaryEventId;
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
