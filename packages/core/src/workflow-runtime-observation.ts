import {
  deriveWorkflowRuntimeObservation,
  type WorkflowRuntimeObservation,
  type WorkflowRuntimeObservationInput
} from "@coordinator/shared";
import type { EventRecord, WorkflowRunRecord } from "@coordinator/db";

export type SurfaceWorkflowRuntimeObservation = Pick<
  WorkflowRuntimeObservation,
  "mode" | "owner" | "handoffKind" | "handoffAvailable"
>;

export function deriveWorkflowRuntimeObservationForRun(
  workflowRun: WorkflowRunRecord,
  events: EventRecord[]
): WorkflowRuntimeObservation {
  const projection = findLatestWorkflowProjection(workflowRun.id, events);
  return deriveWorkflowRuntimeObservation({
    ...projection,
    status: workflowRun.status,
    handoffKind: workflowRun.handoffKind ?? projection?.handoffKind
  });
}

export function deriveWorkflowRuntimeObservationFromPayload(
  workflowRun: Pick<WorkflowRunRecord, "status" | "handoffKind">,
  payload: unknown
): WorkflowRuntimeObservation {
  const projection = workflowProjectionInputFromPayload(payload);
  return deriveWorkflowRuntimeObservation({
    ...projection,
    status: workflowRun.status,
    handoffKind: workflowRun.handoffKind ?? projection?.handoffKind
  });
}

export function toSurfaceWorkflowRuntimeObservation(
  observation: WorkflowRuntimeObservation
): SurfaceWorkflowRuntimeObservation {
  // Surface 面向 outer Agent，只暴露 owner/mode 摘要，避免把 workflow action hints 误当成工具队列。
  return {
    mode: observation.mode,
    owner: observation.owner,
    handoffKind: observation.handoffKind,
    handoffAvailable: observation.handoffAvailable
  };
}

function findLatestWorkflowProjection(
  workflowRunId: string,
  events: EventRecord[]
): WorkflowRuntimeObservationInput | undefined {
  for (const event of [...events].reverse()) {
    if (event.workflowRunId !== workflowRunId) {
      continue;
    }
    if (event.type !== "workflow.status_inspected" && event.type !== "workflow.started" && event.type !== "workflow.action") {
      continue;
    }
    const projection = workflowProjectionInputFromPayload(event.payload);
    if (projection) {
      return projection;
    }
  }
  return undefined;
}

function workflowProjectionInputFromPayload(payload: unknown): WorkflowRuntimeObservationInput | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const debug = isRecord(payload.debug) ? payload.debug : undefined;
  const handoff = isRecord(payload.handoff) ? payload.handoff : undefined;
  return {
    lifecycle: readString(payload.lifecycle),
    handoffAvailable: readBoolean(handoff?.available),
    handoffKind: readString(handoff?.kind),
    allowedActions: readStringArray(debug?.allowedActions),
    deniedActions: [...readStringArray(debug?.deniedActions), ...readStringArray(handoff?.deniedActions)],
    actionInputHints: readActionInputHints(payload.actionInputHints),
    summary: readString(payload.summary)
  };
}

function readActionInputHints(value: unknown): WorkflowRuntimeObservationInput["actionInputHints"] {
  if (!isRecord(value)) {
    return {};
  }
  const hints: WorkflowRuntimeObservationInput["actionInputHints"] = {};
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
