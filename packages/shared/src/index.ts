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
