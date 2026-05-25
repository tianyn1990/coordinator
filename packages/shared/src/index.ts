export const serviceInfo = {
  name: "coordinator",
  stage: "iteration-1-project-skeleton"
} as const;

export type HealthStatus = {
  ok: true;
  service: typeof serviceInfo.name;
  stage: typeof serviceInfo.stage;
};

export function getHealthStatus(): HealthStatus {
  return {
    ok: true,
    service: serviceInfo.name,
    stage: serviceInfo.stage
  };
}

export type WorkflowActionClass = "operator-facing" | "agent-internal" | "debug-only";

export type WorkflowRuntimeObservationMode =
  | "observing-runtime"
  | "waiting-operator-gate"
  | "handoff-ready"
  | "recovery-attention"
  | "completed"
  | "unknown";

export type WorkflowRuntimeOwner =
  | "workflow-runtime"
  | "operator"
  | "coordinator"
  | "pr-review"
  | "recovery"
  | "unknown";

export type WorkflowActionInputHintSummary = {
  requiredArgs?: string[];
  usage?: string;
};

export type WorkflowRuntimeObservationInput = {
  lifecycle?: string;
  status?: string;
  handoffKind?: string;
  handoffAvailable?: boolean;
  allowedActions?: string[];
  deniedActions?: string[];
  actionInputHints?: Record<string, WorkflowActionInputHintSummary>;
  summary?: string;
};

export type WorkflowRuntimeObservation = {
  mode: WorkflowRuntimeObservationMode;
  owner: WorkflowRuntimeOwner;
  reason: string;
  summary: string;
  operatorActions: string[];
  agentInternalActions: string[];
  debugOnlyActions: string[];
  deniedActions: string[];
  handoffKind?: string;
  handoffAvailable: boolean;
  actionInputHints: Record<string, WorkflowActionInputHintSummary>;
};

const OPERATOR_FACING_WORKFLOW_ACTIONS = new Set([
  "freeze-requirements",
  "approve-planning-dossier",
  "approve-review",
  "approve-merge",
  "approve-merge-request",
  "confirm-merge"
]);

const AGENT_INTERNAL_WORKFLOW_ACTIONS = new Set([
  "materialize-change",
  "run-alignment-checks",
  "repair-current-change",
  "repair-current-change-reference",
  "inspect",
  "inspect-surface",
  "inspect-workflow",
  "resume",
  "resume-workflow",
  "continue",
  "continue-workflow",
  "implement-change",
  "apply-change",
  "run-tests",
  "test-align"
]);

export function classifyWorkflowAction(actionId: string): WorkflowActionClass {
  const normalized = actionId.trim();
  if (OPERATOR_FACING_WORKFLOW_ACTIONS.has(normalized)) {
    return "operator-facing";
  }
  if (AGENT_INTERNAL_WORKFLOW_ACTIONS.has(normalized) || isAgentInternalWorkflowActionName(normalized)) {
    return "agent-internal";
  }
  // 未知 action 默认只做 debug 展示，避免把 workflow 内部动作误升成人工 gate。
  return "debug-only";
}

export function isOperatorFacingWorkflowAction(actionId: string): boolean {
  return classifyWorkflowAction(actionId) === "operator-facing";
}

export function deriveWorkflowRuntimeObservation(input: WorkflowRuntimeObservationInput): WorkflowRuntimeObservation {
  const allowedActions = uniqueTrimmed(input.allowedActions ?? []);
  const deniedActions = uniqueTrimmed(input.deniedActions ?? []);
  const groups = groupWorkflowActionsByClass(allowedActions);
  const lifecycle = input.lifecycle?.trim();
  const status = input.status?.trim();
  const handoffAvailable = Boolean(input.handoffAvailable || input.handoffKind);
  const handoffKind = input.handoffKind?.trim() || undefined;

  if (handoffAvailable) {
    return buildWorkflowRuntimeObservation(input, {
      mode: "handoff-ready",
      owner: "coordinator",
      reason: handoffKind ? `workflow handoff ready: ${handoffKind}` : "workflow handoff ready",
      operatorActions: groups.operatorFacing,
      agentInternalActions: groups.agentInternal,
      debugOnlyActions: groups.debugOnly,
      deniedActions,
      handoffKind,
      handoffAvailable
    });
  }
  if (lifecycle === "completed" || status === "completed") {
    return buildWorkflowRuntimeObservation(input, {
      mode: "completed",
      owner: "coordinator",
      reason: "workflow completed",
      operatorActions: groups.operatorFacing,
      agentInternalActions: groups.agentInternal,
      debugOnlyActions: groups.debugOnly,
      deniedActions,
      handoffKind,
      handoffAvailable
    });
  }
  if (status === "blocked" || status === "unknown" || lifecycle === "failed" || lifecycle === "unknown") {
    return buildWorkflowRuntimeObservation(input, {
      mode: "recovery-attention",
      owner: "recovery",
      reason: `workflow requires recovery attention: ${status || lifecycle || "unknown"}`,
      operatorActions: groups.operatorFacing,
      agentInternalActions: groups.agentInternal,
      debugOnlyActions: groups.debugOnly,
      deniedActions,
      handoffKind,
      handoffAvailable
    });
  }
  if (groups.operatorFacing.length > 0) {
    return buildWorkflowRuntimeObservation(input, {
      mode: "waiting-operator-gate",
      owner: "operator",
      reason: `workflow waits for operator gate: ${groups.operatorFacing.join(", ")}`,
      operatorActions: groups.operatorFacing,
      agentInternalActions: groups.agentInternal,
      debugOnlyActions: groups.debugOnly,
      deniedActions,
      handoffKind,
      handoffAvailable
    });
  }
  if (lifecycle === "active" || status === "running" || status === "starting" || status === "planned") {
    return buildWorkflowRuntimeObservation(input, {
      mode: "observing-runtime",
      owner: "workflow-runtime",
      reason:
        groups.agentInternal.length > 0 || groups.debugOnly.length > 0
          ? `workflow runtime is active with internal/debug actions: ${[...groups.agentInternal, ...groups.debugOnly].join(", ")}`
          : "workflow runtime is active; waiting for handoff or next observation",
      operatorActions: groups.operatorFacing,
      agentInternalActions: groups.agentInternal,
      debugOnlyActions: groups.debugOnly,
      deniedActions,
      handoffKind,
      handoffAvailable
    });
  }
  return buildWorkflowRuntimeObservation(input, {
    mode: "unknown",
    owner: "unknown",
    reason: "workflow runtime observation is unknown",
    operatorActions: groups.operatorFacing,
    agentInternalActions: groups.agentInternal,
    debugOnlyActions: groups.debugOnly,
    deniedActions,
    handoffKind,
    handoffAvailable
  });
}

function isAgentInternalWorkflowActionName(actionId: string): boolean {
  return (
    actionId.startsWith("materialize-") ||
    actionId.startsWith("run-alignment-") ||
    actionId.startsWith("repair-") ||
    actionId.startsWith("inspect-") ||
    actionId.startsWith("resume-") ||
    actionId.startsWith("continue-") ||
    actionId.startsWith("implement-") ||
    actionId.startsWith("apply-") ||
    actionId.startsWith("test-") ||
    actionId.startsWith("run-tests")
  );
}

function groupWorkflowActionsByClass(actionIds: string[]): {
  operatorFacing: string[];
  agentInternal: string[];
  debugOnly: string[];
} {
  const groups = { operatorFacing: [] as string[], agentInternal: [] as string[], debugOnly: [] as string[] };
  for (const actionId of actionIds) {
    const actionClass = classifyWorkflowAction(actionId);
    if (actionClass === "operator-facing") {
      groups.operatorFacing.push(actionId);
    } else if (actionClass === "agent-internal") {
      groups.agentInternal.push(actionId);
    } else {
      groups.debugOnly.push(actionId);
    }
  }
  return groups;
}

function buildWorkflowRuntimeObservation(
  input: WorkflowRuntimeObservationInput,
  fields: Omit<WorkflowRuntimeObservation, "summary" | "actionInputHints">
): WorkflowRuntimeObservation {
  return {
    ...fields,
    summary: input.summary?.trim() || fields.reason,
    actionInputHints: sanitizeActionInputHints(input.actionInputHints)
  };
}

function uniqueTrimmed(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function sanitizeActionInputHints(
  hints: Record<string, WorkflowActionInputHintSummary> | undefined
): Record<string, WorkflowActionInputHintSummary> {
  const result: Record<string, WorkflowActionInputHintSummary> = {};
  for (const [actionId, hint] of Object.entries(hints ?? {})) {
    const normalizedActionId = actionId.trim();
    if (!normalizedActionId) {
      continue;
    }
    result[normalizedActionId] = {
      requiredArgs: uniqueTrimmed(hint.requiredArgs ?? []),
      usage: hint.usage?.trim() || undefined
    };
  }
  return result;
}
