import { deriveWorkflowRuntimeObservation, type WorkflowRuntimeObservation } from "@coordinator/shared";
import { buildWorkflowGateInboxItem, summarizeWorkflowGate, type WorkflowGateInboxItem, type WorkflowGateSummary } from "./workflow-actions.js";

export type Project = {
  id: string;
  name: string;
  repoPath?: string;
  repoUrl?: string;
  gitProviderKind?: string;
  defaultBranch?: string;
  prProviderKind?: string;
  workspaceRoot?: string;
  workflowLauncher?: string;
  registrationStatus?: string;
};

export type TaskListItem = {
  id: string;
  projectId: string;
  projectName: string;
  sourceKind: string;
  title: string;
  description: string;
  autonomy: string;
  requestedWorkflowProfile?: string;
  status: string;
  stateVersion: number;
  updatedAt: string;
};

export type HumanRequest = {
  id: string;
  kind: string;
  status: string;
  blockedKey: string;
  questionArtifactPath?: string;
  approvalValid?: boolean;
  stateVersion: number;
};

export type PullRequest = {
  id: string;
  providerKind: string;
  status: string;
  externalId?: string;
  url?: string;
  title?: string;
  bodyArtifactPath?: string;
  reviewStatus: string;
  reviewSummary?: string;
  stateVersion: number;
};

export type EventRecord = {
  id: number;
  type: string;
  summary: string;
  severity: string;
  workflowRunId?: string;
  operationId?: string;
  payload?: unknown;
  artifactRefs: string[];
  createdAt: string;
};

export type NormalizedAgentEvent = {
  kind: string;
  summary: string;
  timestamp?: string;
  severity: string;
};

export type AgentActivitySummary = {
  state: string;
  providerId?: string;
  implementationMode?: string;
  lastActivityAt?: string;
  latestEvent?: NormalizedAgentEvent;
  eventCount: number;
  failureKind?: string;
  artifactRefs: {
    transcriptPath?: string;
    rawEventArtifactPath?: string;
    finalResponsePath?: string;
  };
};

export type SurfaceEnvelope = {
  surfaceKind: string;
  json: {
    recommended_next_step: string;
    denied_actions: string[];
    available_tools: Array<{ name: string; usage: string; args: string[]; side_effect: boolean }>;
    artifact_root: string;
    attachments?: Array<{ id: string; safe_filename: string; mime_type: string; size_bytes: number; artifact_path: string }>;
    task_notes?: Array<{ event_id: number; artifact_path: string; summary: string }>;
  };
  markdown: string;
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
  operationLedger: Array<{
    id: string;
    kind: string;
    status: string;
    failureCode?: string;
    lastDecision?: string;
    lastReasonCode?: string;
    lastError?: string;
    lastObservedSummary?: string;
  }>;
  recoveryTimeline: Array<{
    eventId: number;
    decision?: string;
    reasonCode?: string;
    observedSummary?: string;
    nextAction?: string;
    operatorAttentionRequired: boolean;
    artifactRefs: string[];
    severity: string;
    createdAt: string;
  }>;
  providerProtocolInspections: Array<{
    eventId: number;
    type: string;
    summary: string;
    resource?: string;
    operationId?: string;
    artifactRefs: string[];
    severity: string;
    createdAt: string;
  }>;
};

export type TaskDetail = {
  task: TaskListItem;
  project: Project;
  attempt?: { id: string; status: string; reason: string; stateVersion: number };
  executionPlan?: { id: string; status: string; artifactPath?: string };
  workspace?: { id: string; status: string; workspacePath?: string; branch?: string };
  workflowRuns: Array<{ id: string; profileId: string; status: string; handoffKind?: string; stateVersion: number }>;
  workflowObservation?: WorkflowRuntimeObservation;
  agentSessions: Array<{
    id: string;
    providerKind: string;
    role: string;
    status: string;
    finalResponsePath?: string;
    activity?: AgentActivitySummary;
  }>;
  pullRequests: PullRequest[];
  latestPullRequest?: PullRequest;
  humanRequests: HumanRequest[];
  attachments: TaskAttachment[];
  taskNotes: TaskNoteRef[];
  events: EventRecord[];
  surface: SurfaceEnvelope;
  currentBlocker: string;
  diagnosis: OperatorTaskDiagnosis;
};

export type TaskAttachment = {
  id: string;
  projectId: string;
  taskId: string;
  attemptId?: string;
  artifactId: string;
  artifactPath: string;
  originalFilename: string;
  safeFilename: string;
  mimeType: string;
  sizeBytes: number;
  actor: string;
  retentionKind: string;
  createdAt: string;
};

export type TaskNoteRef = {
  eventId: number;
  artifactPath: string;
  summary: string;
  actor?: string;
  createdAt: string;
};

export type RailTone = "done" | "active" | "waiting" | "attention" | "idle";

export type RailNode = {
  id: string;
  label: string;
  tone: RailTone;
  summary: string;
};

export type WorkflowActionHint = {
  actionId: string;
  requiredArgs: string[];
  usage?: string;
};

export type WorkflowProjection = {
  profile?: string;
  lifecycle?: string;
  stage?: string;
  substate?: string;
  gateState?: string;
  gateReason?: string;
  progressLabel?: string;
  progressSummary?: string;
  handoff?: string;
  allowedActions: string[];
  deniedActions: string[];
  actionHints: WorkflowActionHint[];
  stageArtifacts: Array<{ kind: string; path: string; label?: string; requiredForHandoff?: boolean }>;
};

export type WorkflowLensSummary = {
  profile: string;
  lifecycle: string;
  stage: string;
  substate: string;
  handoff: string;
  observation: WorkflowRuntimeObservation;
  gate: WorkflowGateSummary;
  projection: WorkflowProjection;
  latestEvents: EventRecord[];
  inspectOnlyReason: string;
};

export type WorkflowGateEvidence = {
  workflowRunId: string;
  taskId: string;
  attemptId: string;
  workflowRunStateVersion: number;
  evidenceStatus: "ready" | "partial" | "missing";
  canSubmit: boolean;
  primaryAction?: string;
  actionIds: string[];
  primaryMessage?: {
    source: string;
    agentSessionId: string;
    providerKind: string;
    status: string;
    text: string;
    artifactPath?: string;
  };
  recentMessages: Array<{
    agentSessionId: string;
    providerKind: string;
    status: string;
    text: string;
    artifactPath?: string;
  }>;
  protocolFacts: {
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
  supportingArtifacts: string[];
  warnings: string[];
};

export type RunMatrixRow = {
  dataTaskId: string;
  ariaLabel: string;
  task: TaskListItem;
  detail?: TaskDetail;
  statusTone: "running" | "waiting" | "attention" | "done" | "idle";
  pin: "needs-me" | "attention" | "running" | "done" | "idle";
  blocker: string;
  nextOwner: string;
  workflow: WorkflowLensSummary;
  outerRail: RailNode[];
  workflowRail: RailNode[];
  prSummary: string;
  agentSummary: string;
  artifactRefs: string[];
  gateItems: GateItem[];
  needsMe: boolean;
  attentionRequired: boolean;
};

export const WEB_V2_DEBUG_DETAIL_DEFAULT_OPEN = false;

export type GateItem =
  | WorkflowGateInboxItem
  | {
      id: string;
      taskId: string;
      projectName: string;
      title: string;
      kind: "human" | "merge" | "attention" | "pr";
      tone: "waiting" | "attention" | "danger";
      label: string;
      summary: string;
    };

export type UnifiedComposerMode = "new-task" | "human-answer" | "task-note";

export type UnifiedComposerProjection = {
  mode: UnifiedComposerMode;
  taskId?: string;
  humanRequest?: HumanRequest;
  title: string;
  placeholder: string;
  submitLabel: string;
};

export type WorkbenchV2Model = {
  rows: RunMatrixRow[];
  inbox: GateItem[];
  metrics: {
    total: number;
    running: number;
    needsMe: number;
    attention: number;
    done: number;
  };
};

export type RunUntilBlockedScope = "global" | "task";

export type RunUntilBlockedStopKind =
  | "continue"
  | "observing-runtime"
  | "waiting-operator-gate"
  | "handoff-ready"
  | "recovery-attention"
  | "terminal"
  | "no-candidate"
  | "max-ticks"
  | "failed"
  | "unavailable";

export type RunUntilBlockedTickSummary = {
  status: string;
  actions: Array<{
    kind?: string;
    taskId?: string;
    workflowRunId?: string;
    status?: string;
    summary?: string;
  }>;
};

export type RunUntilBlockedStopReason = {
  stop: boolean;
  kind: RunUntilBlockedStopKind;
  label: string;
  summary: string;
  scope: RunUntilBlockedScope;
  taskId?: string;
};

export function buildWorkbenchV2Model(input: {
  tasks: TaskListItem[];
  details: Record<string, TaskDetail>;
  projectId: string;
  query: string;
}): WorkbenchV2Model {
  const normalizedQuery = input.query.trim().toLowerCase();
  const rows = input.tasks
    .filter((task) => input.projectId === "all" || task.projectId === input.projectId)
    .filter((task) => {
      if (!normalizedQuery) return true;
      return `${task.title} ${task.projectName} ${task.status}`.toLowerCase().includes(normalizedQuery);
    })
    .map((task) => buildRunMatrixRow(task, input.details[task.id]));

  return {
    rows,
    inbox: rows.flatMap((row) => row.gateItems),
    metrics: {
      total: rows.length,
      running: rows.filter((row) => row.pin === "running").length,
      needsMe: rows.filter((row) => row.gateItems.length > 0).length,
      attention: rows.filter((row) => row.attentionRequired).length,
      done: rows.filter((row) => row.pin === "done").length
    }
  };
}

export function buildRunMatrixRow(task: TaskListItem, detail?: TaskDetail): RunMatrixRow {
  const workflow = buildWorkflowLensSummary(task, detail);
  const attentionRequired = Boolean(detail?.diagnosis.operatorAttention.required || isHighRiskStatus(task.status));
  const blocker = detail?.currentBlocker ?? task.status;
  const gateItems = buildNeedsMeGateProjection({ task, detail, workflow, blocker, attentionRequired });
  const needsMe = gateItems.length > 0;
  const pin = needsMe ? "needs-me" : attentionRequired ? "attention" : isTerminalTaskStatus(task.status) ? "done" : isRunningTask(task.status, detail) ? "running" : "idle";
  return {
    dataTaskId: task.id,
    ariaLabel: `Open task ${task.title}`,
    task,
    detail,
    statusTone: taskTone(task.status, needsMe, attentionRequired, pin),
    pin,
    blocker,
    nextOwner: nextOwner(task, workflow, gateItems),
    workflow,
    outerRail: buildOuterRail(task, detail),
    workflowRail: buildWorkflowRail(workflow),
    prSummary: prSummary(detail),
    agentSummary: agentSummary(detail),
    artifactRefs: collectArtifactRefs(detail, workflow).slice(0, 5),
    gateItems,
    needsMe,
    attentionRequired
  };
}

export function buildWorkflowLensSummary(task: TaskListItem, detail?: TaskDetail): WorkflowLensSummary {
  const run = detail?.workflowRuns[0];
  const projection = detail ? extractWorkflowProjection(detail, run?.id) : emptyWorkflowProjection();
  const lifecycle = projection.lifecycle ?? run?.status ?? "none";
  const handoff = projection.handoff ?? run?.handoffKind ?? "none";
  const observation =
    detail?.workflowObservation ??
    deriveWorkflowRuntimeObservation({
      lifecycle,
      status: run?.status,
      handoffKind: run?.handoffKind,
      handoffAvailable: handoff !== "none",
      allowedActions: projection.allowedActions,
      deniedActions: projection.deniedActions,
      actionInputHints: Object.fromEntries(projection.actionHints.map((hint) => [hint.actionId, { requiredArgs: hint.requiredArgs, usage: hint.usage }])),
      summary: projection.progressSummary ?? detail?.currentBlocker ?? task.status
    });
  return {
    profile: projection.profile ?? run?.profileId ?? task.requestedWorkflowProfile ?? "auto",
    lifecycle,
    stage: projection.stage ?? "unknown",
    substate: projection.substate ?? "none",
    handoff,
    observation,
    gate: summarizeWorkflowGate(projection.allowedActions, observation),
    projection,
    latestEvents: (detail?.events ?? []).filter((event) => event.type.startsWith("workflow.")).slice(-4),
    inspectOnlyReason:
      run?.status === "running" && !run.handoffKind && observation.mode !== "waiting-operator-gate"
        ? "observing workflow runtime / inner agent; no operator action"
        : "display only; Core remains policy gate"
  };
}

export function buildOuterRail(task: TaskListItem, detail?: TaskDetail): RailNode[] {
  const workflow = detail?.workflowRuns[0];
  const pr = detail?.latestPullRequest;
  return [
    { id: "task", label: "Task", tone: toneForTask(task.status), summary: task.status },
    { id: "plan", label: "Plan", tone: detail?.executionPlan ? "done" : "idle", summary: detail?.executionPlan?.status ?? "none" },
    { id: "workspace", label: "Workspace", tone: detail?.workspace?.status === "ready" ? "done" : detail?.workspace ? "waiting" : "idle", summary: detail?.workspace?.branch ?? "none" },
    { id: "workflow", label: "Workflow", tone: workflow?.status === "running" ? "active" : workflow?.handoffKind ? "done" : workflow ? "waiting" : "idle", summary: workflow?.status ?? "none" },
    { id: "pr", label: "PR", tone: pr ? (pr.status === "merged" ? "done" : "waiting") : "idle", summary: pr?.status ?? "none" },
    { id: "review", label: "Review", tone: pr?.reviewStatus === "approved" ? "done" : pr ? "active" : "idle", summary: pr?.reviewStatus ?? "none" },
    { id: "merge", label: "Merge", tone: pr?.status === "merged" ? "done" : pr ? "waiting" : "idle", summary: pr?.status === "merged" ? "merged" : "none" }
  ];
}

export function buildWorkflowRail(workflow: WorkflowLensSummary): RailNode[] {
  const stages = ["requirements", "planning", "implementation", "review", "handoff"];
  const currentIndex = stages.indexOf(workflow.stage);
  return stages.map((stage, index) => ({
    id: stage,
    label: stage,
    tone: currentIndex === -1 ? (stage === "requirements" && workflow.lifecycle !== "none" ? "active" : "idle") : index < currentIndex ? "done" : index === currentIndex ? "active" : "idle",
    summary: stage === workflow.stage ? workflow.substate : ""
  }));
}

export function buildGateItems(row: RunMatrixRow): GateItem[] {
  return row.gateItems;
}

export function deriveUnifiedComposerProjection(input: {
  selectedTask?: TaskListItem;
  detail?: TaskDetail;
}): UnifiedComposerProjection {
  if (!input.selectedTask || !input.detail) {
    return {
      mode: "new-task",
      title: "New task",
      placeholder: "Describe the task",
      submitLabel: "Create"
    };
  }
  const pendingHuman = input.detail.humanRequests.find(
    (request) => request.status === "pending" && request.kind !== "merge_approval"
  );
  if (pendingHuman) {
    return {
      mode: "human-answer",
      taskId: input.selectedTask.id,
      humanRequest: pendingHuman,
      title: input.selectedTask.title,
      placeholder: "Answer the pending request",
      submitLabel: "Answer"
    };
  }
  // Workflow operator gate、merge approval 与 internal action 都由专门 panel 处理；Composer 只追加上下文。
  return {
    mode: "task-note",
    taskId: input.selectedTask.id,
    title: input.selectedTask.title,
    placeholder: "Add context or follow-up",
    submitLabel: "Add note"
  };
}

export function deriveRunUntilBlockedStopReason(input: {
  detail?: TaskDetail;
  tick: RunUntilBlockedTickSummary;
  tickIndex: number;
  maxTicks: number;
  scope: RunUntilBlockedScope;
  taskId?: string;
}): RunUntilBlockedStopReason {
  const stop = (kind: RunUntilBlockedStopKind, label: string, summary: string, shouldStop = true): RunUntilBlockedStopReason => ({
    stop: shouldStop,
    kind,
    label,
    summary,
    scope: input.scope,
    taskId: input.taskId
  });

  if (input.scope === "global") {
    if (input.tick.status === "failed") return stop("failed", "Global tick failed", "global daemon tick failed");
    if (input.tick.actions.length === 0) return stop("no-candidate", "No candidate", "global queue has no safe action");
    if (input.tickIndex >= input.maxTicks) return stop("max-ticks", "Max ticks", `stopped after ${input.maxTicks} ticks`);
    return stop("continue", "Continue", "advancing global queue", false);
  }

  if (!input.detail) return stop("unavailable", "Task detail unavailable", "task detail unavailable");
  if (input.tick.status === "failed") return stop("failed", "Task tick failed", "daemon tick failed for current task");

  const row = buildRunMatrixRow(input.detail.task, input.detail);
  const attentionItem = row.gateItems.find((item) => item.kind === "attention");
  const workflowGate = row.gateItems.find((item) => item.kind === "workflow");
  const operatorGate = row.gateItems.find((item) => item.kind === "human" || item.kind === "merge" || item.kind === "pr");

  if (row.workflow.observation.mode === "recovery-attention" || attentionItem) {
    return stop("recovery-attention", "Recovery attention", attentionItem?.summary ?? row.workflow.observation.reason);
  }
  if (workflowGate || row.workflow.observation.mode === "waiting-operator-gate") {
    return stop("waiting-operator-gate", "Workflow gate", workflowGate?.summary ?? row.workflow.observation.reason);
  }
  if (operatorGate) {
    return stop("waiting-operator-gate", operatorGate.label, operatorGate.summary);
  }
  if (row.workflow.observation.mode === "handoff-ready" || input.detail.workflowRuns[0]?.handoffKind) {
    return stop("handoff-ready", "Handoff ready", row.workflow.observation.reason);
  }
  if (isTerminalTaskStatus(input.detail.task.status)) {
    return stop("terminal", "Terminal", `terminal: ${input.detail.task.status}`);
  }
  if (row.workflow.observation.mode === "observing-runtime" || (input.detail.workflowRuns[0]?.status === "running" && !input.detail.workflowRuns[0]?.handoffKind)) {
    // Web 只说明“正在观察 inner runtime”，不把 agent/internal action 变成 operator 待办。
    return stop("observing-runtime", "Observing runtime", "waiting for workflow runtime, inner agent, or handoff");
  }
  if (input.tickIndex >= input.maxTicks) return stop("max-ticks", "Max ticks", `stopped after ${input.maxTicks} ticks`);
  return stop("continue", "Continue", "advancing current task", false);
}

function buildNeedsMeGateProjection(input: {
  task: TaskListItem;
  detail?: TaskDetail;
  workflow: WorkflowLensSummary;
  blocker: string;
  attentionRequired: boolean;
}): GateItem[] {
  const items: GateItem[] = [];
  const detail = input.detail;
  if (!detail) {
    if (input.attentionRequired) {
      items.push(buildAttentionGateItem(input, undefined));
    }
    return items;
  }

  const pendingHuman = detail.humanRequests.filter((request) => request.status === "pending" && request.kind !== "merge_approval");
  const pendingMerge = detail.humanRequests.filter((request) => request.status === "pending" && request.kind === "merge_approval");
  for (const request of pendingHuman) {
    items.push({
      id: `human-${request.id}`,
      taskId: input.task.id,
      projectName: input.task.projectName,
      title: input.task.title,
      kind: "human",
      tone: "waiting",
      label: "Human request",
      summary: request.questionArtifactPath ?? request.blockedKey
    });
  }
  for (const request of pendingMerge) {
    items.push({
      id: `merge-${request.id}`,
      taskId: input.task.id,
      projectName: input.task.projectName,
      title: input.task.title,
      kind: "merge",
      tone: request.approvalValid === false ? "danger" : "waiting",
      label: "Merge approval",
      summary: request.approvalValid === false ? "snapshot invalid" : "waiting decision"
    });
  }
  const workflowGate = buildWorkflowGateInboxItem({
    taskId: input.task.id,
    projectName: input.task.projectName,
    title: input.task.title,
    actionIds: input.workflow.projection.allowedActions,
    observation: input.workflow.observation
  });
  // 单一 projection 只消费 Core/shared classification，避免不同组件把 internal action 误升成人工 gate。
  if (workflowGate) items.push(workflowGate);
  if (input.attentionRequired) {
    items.push(buildAttentionGateItem(input, detail));
  }
  if (detail.latestPullRequest && prNeedsOperator(detail.latestPullRequest)) {
    items.push({
      id: `pr-${detail.latestPullRequest.id}`,
      taskId: input.task.id,
      projectName: input.task.projectName,
      title: input.task.title,
      kind: "pr",
      tone: "waiting",
      label: "PR / MR review",
      summary: `${detail.latestPullRequest.status} / ${detail.latestPullRequest.reviewStatus}`
    });
  }
  return items;
}

export function extractWorkflowProjection(detail: TaskDetail, workflowRunId?: string): WorkflowProjection {
  // Web V2 只从 Core/API 持久化的公开 event payload 派生展示信息，避免读取 `.workflow` private state。
  const workflowEvents = [...detail.events]
    .reverse()
    .filter((event) => event.type.startsWith("workflow.") && (!workflowRunId || event.workflowRunId === workflowRunId));
  for (const event of workflowEvents) {
    const payload = isRecord(event.payload) ? event.payload : undefined;
    const status = isRecord(payload?.status) ? payload.status : payload;
    const debug = isRecord(status?.debug) ? status.debug : isRecord(payload?.debug) ? payload.debug : undefined;
    const gate = isRecord(status?.gate) ? status.gate : isRecord(debug?.gate) ? debug.gate : undefined;
    const progress = isRecord(status?.progress) ? status.progress : isRecord(debug?.progress) ? debug.progress : undefined;
    const handoff = isRecord(status?.handoff) ? status.handoff : isRecord(payload?.handoff) ? payload.handoff : undefined;
    const projection: WorkflowProjection = {
      profile: readString(status?.profile ?? payload?.profile),
      lifecycle: readString(status?.lifecycle ?? payload?.lifecycle),
      stage: readString(status?.stage ?? debug?.stage),
      substate: readString(status?.substate ?? debug?.substate),
      gateState: readString(gate?.state),
      gateReason: readString(gate?.reason),
      progressLabel: readString(progress?.label),
      progressSummary: readString(progress?.summary ?? status?.summary ?? payload?.summary),
      handoff: readHandoffSummary(handoff),
      allowedActions: readStringArray(status?.allowedActions ?? debug?.allowedActions),
      deniedActions: readStringArray(status?.deniedActions ?? debug?.deniedActions),
      actionHints: readActionHints(status?.actionInputHints ?? status?.actionInputs ?? debug?.actionInputHints ?? debug?.actionInputs),
      stageArtifacts: readArtifactRefs(status?.stageArtifacts ?? debug?.stageArtifacts)
    };
    if (hasWorkflowProjectionSignal(projection)) return projection;
  }
  return emptyWorkflowProjection();
}

export function collectArtifactRefs(detail: TaskDetail | undefined, workflow: WorkflowLensSummary): string[] {
  return [
    detail?.executionPlan?.artifactPath,
    detail?.agentSessions.find((session) => session.finalResponsePath)?.finalResponsePath,
    detail?.latestPullRequest?.bodyArtifactPath,
    ...(detail?.attachments.map((attachment) => attachment.artifactPath) ?? []),
    ...(detail?.taskNotes.map((note) => note.artifactPath) ?? []),
    ...workflow.projection.stageArtifacts.map((artifact) => artifact.path),
    ...(detail?.events.flatMap((event) => event.artifactRefs) ?? [])
  ]
    .filter((item): item is string => Boolean(item))
    .filter((item, index, list) => list.indexOf(item) === index);
}

export function isTerminalTaskStatus(status: string): boolean {
  return status === "completed" || status === "handoff" || status === "canceled" || status === "failed";
}

export function isHighRiskStatus(status: string): boolean {
  return status === "failed" || status === "unknown" || status === "blocked";
}

function emptyWorkflowProjection(): WorkflowProjection {
  return { allowedActions: [], deniedActions: [], actionHints: [], stageArtifacts: [] };
}

function hasWorkflowProjectionSignal(projection: WorkflowProjection): boolean {
  return Boolean(
    projection.profile ||
      projection.lifecycle ||
      projection.stage ||
      projection.substate ||
      projection.gateState ||
      projection.progressLabel ||
      projection.progressSummary ||
      projection.handoff ||
      projection.allowedActions.length ||
      projection.deniedActions.length ||
      projection.actionHints.length ||
      projection.stageArtifacts.length
  );
}

function taskTone(status: string, needsMe: boolean, attentionRequired: boolean, pin: RunMatrixRow["pin"]): RunMatrixRow["statusTone"] {
  if (attentionRequired || pin === "attention") return "attention";
  if (needsMe || status.includes("waiting") || status === "merge_waiting") return "waiting";
  if (pin === "done") return "done";
  if (pin === "running") return "running";
  return "idle";
}

function toneForTask(status: string): RailTone {
  if (isHighRiskStatus(status)) return "attention";
  if (isTerminalTaskStatus(status)) return "done";
  if (status.includes("waiting")) return "waiting";
  if (status === "queued" || status === "created") return "idle";
  return "active";
}

function isRunningTask(status: string, detail?: TaskDetail): boolean {
  return Boolean(status === "planning" || status === "running" || status === "resuming" || status === "human_answered" || detail?.workflowRuns.some((run) => run.status === "running") || detail?.agentSessions.some((session) => session.status === "running"));
}

function nextOwner(
  task: TaskListItem,
  workflow: WorkflowLensSummary,
  gateItems: GateItem[]
): string {
  const firstGate = gateItems[0];
  if (firstGate?.kind === "merge") return "human approval";
  if (firstGate?.kind === "human") return "human answer";
  if (firstGate?.kind === "workflow") return "operator gate";
  if (firstGate?.kind === "attention") return "operator recovery";
  if (firstGate?.kind === "pr") return "PR/MR review";
  if (workflow.observation.mode === "handoff-ready") return "coordinator handoff";
  if (workflow.observation.mode === "recovery-attention") return "operator recovery";
  if (workflow.observation.mode === "observing-runtime") return "workflow runtime";
  if (isTerminalTaskStatus(task.status)) return "none";
  return task.status;
}

function prSummary(detail?: TaskDetail): string {
  if (!detail?.latestPullRequest) return "PR none";
  return `${detail.latestPullRequest.status} / ${detail.latestPullRequest.reviewStatus}`;
}

function prNeedsOperator(pr: PullRequest | undefined): boolean {
  if (!pr) return false;
  const status = normalizeStatusToken(pr.status);
  const reviewStatus = normalizeStatusToken(pr.reviewStatus);
  return (
    status === "conflict" ||
    reviewStatus === "conflict" ||
    reviewStatus === "review_required" ||
    reviewStatus === "changes_requested" ||
    reviewStatus === "blocked"
  );
}

function buildAttentionGateItem(
  source: { task: TaskListItem; blocker: string },
  detail: TaskDetail | undefined
): GateItem {
  return {
    id: `attention-${source.task.id}`,
    taskId: source.task.id,
    projectName: source.task.projectName,
    title: source.task.title,
    kind: "attention",
    tone: isHighRiskStatus(source.task.status) ? "danger" : "attention",
    label: isHighRiskStatus(source.task.status) ? "High risk" : "Operator attention",
    summary: detail?.diagnosis.operatorAttention.reasons[0] ?? source.blocker
  };
}

function normalizeStatusToken(value: string | undefined): string {
  return (value ?? "unknown").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function agentSummary(detail?: TaskDetail): string {
  const latest = detail?.agentSessions[0];
  if (!latest) return "agent none";
  const activity = latest.activity;
  return `${latest.providerKind} / ${activity?.state ?? latest.status}${activity?.lastActivityAt ? ` / ${formatRelativeTime(activity.lastActivityAt)}` : ""}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function readActionHints(value: unknown): WorkflowActionHint[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([actionId, rawHint]) => {
    if (!isRecord(rawHint)) return [];
    return [{ actionId, requiredArgs: readStringArray(rawHint.requiredArgs), usage: readString(rawHint.usage) }];
  });
}

function readArtifactRefs(value: unknown): WorkflowProjection["stageArtifacts"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const path = readString(item.path);
    if (!path) return [];
    return [
      {
        kind: readString(item.kind) ?? "artifact",
        path,
        label: readString(item.label),
        requiredForHandoff: typeof item.requiredForHandoff === "boolean" ? item.requiredForHandoff : undefined
      }
    ];
  });
}

function readHandoffSummary(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const available = typeof value.available === "boolean" ? value.available : undefined;
  const kind = readString(value.kind);
  if (available === false) return "none";
  if (available === true) return kind ?? "available";
  return kind;
}

function formatRelativeTime(value: string): string {
  const timestamp = Date.parse(value.replace(" ", "T"));
  if (!Number.isFinite(timestamp)) return value;
  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (diffMinutes < 1) return "now";
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 48) return `${diffHours}h`;
  return `${Math.round(diffHours / 24)}d`;
}
