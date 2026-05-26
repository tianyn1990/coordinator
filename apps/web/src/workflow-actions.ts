import { classifyWorkflowAction, type WorkflowRuntimeObservation } from "@coordinator/shared";
import type { TaskDetail, WorkflowGateEvidence } from "./workbench-v2-model.js";

export type WorkflowActionGroups = {
  operatorFacing: string[];
  agentInternal: string[];
  debugOnly: string[];
};

export type WorkflowGateSummary = {
  hasOperatorGate: boolean;
  operatorActions: string[];
  label: string;
  summary: string;
};

export type WorkflowGateInboxSource = {
  taskId: string;
  projectName: string;
  title: string;
  actionIds?: string[];
  observation?: WorkflowRuntimeObservation;
};

export type WorkflowGateInboxItem = {
  id: string;
  taskId: string;
  projectName: string;
  title: string;
  kind: "workflow";
  tone: "waiting";
  label: string;
  summary: string;
};

export function groupWorkflowActions(actionIds: string[]): WorkflowActionGroups {
  const groups: WorkflowActionGroups = { operatorFacing: [], agentInternal: [], debugOnly: [] };
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

export function workflowActionButtonLabel(actionId: string): string {
  if (actionId === "freeze-requirements") {
    return "Approve requirements and continue";
  }
  if (actionId === "approve-planning-dossier") {
    return "Approve plan and continue";
  }
  if (actionId === "approve-review") {
    return "Approve review and continue";
  }
  return "Confirm and continue";
}

export function summarizeWorkflowGate(
  actionIds: string[] = [],
  observation?: WorkflowRuntimeObservation
): WorkflowGateSummary {
  if (observation && observation.mode !== "waiting-operator-gate") {
    return {
      hasOperatorGate: false,
      operatorActions: [],
      label: "Workflow active",
      summary: observation.mode === "observing-runtime" ? "observing internal/debug workflow action" : observation.mode
    };
  }
  const groups = observation
    ? {
        operatorFacing: observation.operatorActions,
        agentInternal: observation.agentInternalActions,
        debugOnly: observation.debugOnlyActions
      }
    : groupWorkflowActions(actionIds);
  if (groups.operatorFacing.length === 0) {
    return {
      hasOperatorGate: false,
      operatorActions: [],
      label: "Workflow active",
      summary:
        observation?.mode === "observing-runtime" || groups.agentInternal.length > 0 || groups.debugOnly.length > 0
          ? "observing internal/debug workflow action"
          : "waiting workflow handoff"
    };
  }
  return {
    hasOperatorGate: true,
    operatorActions: groups.operatorFacing,
    label: workflowActionInboxLabel(groups.operatorFacing[0]),
    summary: groups.operatorFacing.join(", ")
  };
}

export function buildWorkflowGateInboxItem(source: WorkflowGateInboxSource): WorkflowGateInboxItem | undefined {
  const gate = summarizeWorkflowGate(source.actionIds, source.observation);
  if (!gate.hasOperatorGate) {
    return undefined;
  }
  return {
    id: `workflow-gate-${source.taskId}-${gate.operatorActions.join("-")}`,
    taskId: source.taskId,
    projectName: source.projectName,
    title: source.title,
    kind: "workflow",
    tone: "waiting",
    label: gate.label,
    summary: gate.summary
  };
}

export function workflowGateEvidenceCanSubmit(
  evidence: WorkflowGateEvidence | undefined,
  actionId: string
): boolean {
  return Boolean(evidence?.canSubmit && evidence.primaryAction === actionId && evidence.evidenceStatus === "ready");
}

export function workflowGateEvidenceStatusLabel(evidence: WorkflowGateEvidence | undefined): string {
  if (!evidence) {
    return "Loading gate evidence";
  }
  if (evidence.evidenceStatus === "ready") {
    return "Evidence ready";
  }
  if (evidence.evidenceStatus === "partial") {
    return "Evidence needs review";
  }
  return "Missing gate evidence";
}

export function buildWorkflowGateEvidenceRefreshKey(detail: TaskDetail | undefined): string {
  if (!detail) {
    return "no-detail";
  }
  return detail.agentSessions
    .filter((session) => session.role === "inner")
    .map((session) =>
      [
        session.id,
        session.status,
        session.finalResponsePath ?? "",
        session.activity?.lastActivityAt ?? "",
        session.activity?.latestEvent?.timestamp ?? "",
        session.activity?.eventCount ?? 0
      ].join(":")
    )
    .join("|");
}

function workflowActionInboxLabel(actionId: string): string {
  if (actionId === "freeze-requirements") {
    return "Requirements approval";
  }
  if (actionId === "approve-planning-dossier") {
    return "Plan approval";
  }
  if (actionId === "approve-review") {
    return "Review approval";
  }
  return "Workflow approval";
}
