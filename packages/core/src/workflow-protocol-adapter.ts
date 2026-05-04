import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  ActiveResourceConflictError,
  acquireLock,
  appendEvent,
  createOperation,
  createWorkflowRun,
  getActiveWorkflowRunByAttempt,
  getActiveWorkspaceByAttempt,
  getAttempt,
  getOperationByIdempotencyKey,
  getProject,
  getWorkflowRun,
  releaseLock,
  updateOperation,
  updateWorkflowRun,
  withTransaction,
  type AttemptRecord,
  type DbContext,
  type LockRecord,
  type ProjectRecord,
  type WorkflowRunRecord
} from "@coordinator/db";

const DEFAULT_PROTOCOL_TIMEOUT_MS = 120_000;

export type WorkflowProtocolRunner = (args: string[], options: { cwd: string; launcher: string; timeoutMs: number }) => string;

export type WorkflowProfileCapability = {
  id: string;
  purpose: string;
  implemented: boolean;
};

export type WorkflowCapabilities = {
  protocolVersion: "1";
  profiles: WorkflowProfileCapability[];
  commands: string[];
  handoffKinds: WorkflowHandoffKind[];
};

export type WorkflowHandoffKind =
  | "pr_ready"
  | "human_review_required"
  | "manual_handoff"
  | "blocked"
  | "completed_no_pr";

export type WorkflowLifecycle = "active" | "completed" | "failed" | "unknown";

export type WorkflowHandoff = {
  available: boolean;
  kind?: WorkflowHandoffKind;
  reason?: string;
  artifacts: Array<{ kind?: string; path: string; requiredForHandoff?: boolean }>;
  nextStep?: { action?: string; guidance?: string };
  deniedActions: string[];
  recovery?: { action?: string; guidance?: string };
};

export type WorkflowStatus = {
  runId: string;
  profile?: string;
  lifecycle: WorkflowLifecycle;
  summary?: string;
  handoff: WorkflowHandoff;
  artifactRoot?: string;
  debug: {
    stage?: string;
    substate?: string;
    gate?: unknown;
    allowedActions?: string[];
    deniedActions?: string[];
    currentChange?: unknown;
    eventLog?: string;
  };
};

export type WorkflowArtifacts = {
  runId: string;
  artifactRoot?: string;
  artifacts: Array<{ kind?: string; path: string; requiredForHandoff?: boolean }>;
};

export type WorkflowEvents = {
  runId: string;
  eventsPath?: string;
  latest: Array<{ timestamp?: string; type: string; summary: string }>;
};

export type StartWorkflowRunInput = {
  attemptId: string;
  profileId: string;
  owner?: string;
  ttlMs?: number;
  now?: Date;
  runner?: WorkflowProtocolRunner;
};

export type WorkflowRunResult = {
  workflowRun: WorkflowRunRecord;
  operationId?: string;
  status: WorkflowStatus;
  reused: boolean;
};

export type InspectWorkflowCapabilitiesInput = {
  projectId: string;
  runner?: WorkflowProtocolRunner;
};

export type InspectWorkflowRunInput = {
  workflowRunId: string;
  runner?: WorkflowProtocolRunner;
};

export type InvokeWorkflowActionInput = {
  workflowRunId: string;
  action: string;
  arg?: string;
  expectedStateVersion: number;
  owner?: string;
  ttlMs?: number;
  now?: Date;
  runner?: WorkflowProtocolRunner;
};

export type ListWorkflowArtifactsInput = {
  workflowRunId: string;
  runner?: WorkflowProtocolRunner;
};

export type ListWorkflowEventsInput = {
  workflowRunId: string;
  runner?: WorkflowProtocolRunner;
};

export class WorkflowProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowProtocolError";
  }
}

export function inspectWorkflowCapabilities(
  context: DbContext,
  input: InspectWorkflowCapabilitiesInput
): WorkflowCapabilities {
  const project = requireProjectRecord(context, input.projectId);
  const capabilities = readCapabilities(project, requireProjectRepoPath(project), input.runner ?? runWorkflowProtocol);
  appendEvent(context, {
    type: "workflow.capabilities_inspected",
    summary: `workflow capabilities inspected: ${project.id}`,
    projectId: project.id,
    payload: {
      protocolVersion: capabilities.protocolVersion,
      profiles: capabilities.profiles,
      commands: capabilities.commands,
      handoffKinds: capabilities.handoffKinds
    }
  });
  return capabilities;
}

export function startWorkflowRun(context: DbContext, input: StartWorkflowRunInput): WorkflowRunResult {
  const owner = input.owner ?? "workflow-adapter";
  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? 5 * 60 * 1000;
  const runner = input.runner ?? runWorkflowProtocol;
  const attempt = requireAttemptRecord(context, input.attemptId);
  const project = requireProjectRecord(context, attempt.projectId);
  const workspace = requireReadyWorkspace(context, attempt.id);
  const launcher = requireWorkflowLauncher(project);
  const capabilities = readCapabilities(project, requireProjectRepoPath(project), runner);
  assertImplementedProfile(capabilities, input.profileId);

  const existing = getActiveWorkflowRunByAttempt(context, attempt.id);
  if (existing) {
    if (existing.profileId !== input.profileId) {
      throw new ActiveResourceConflictError(
        `attempt ${attempt.id} 已有 active workflow run profile=${existing.profileId}，不能复用为 ${input.profileId}`
      );
    }
    if (!existing.externalId) {
      throw new ActiveResourceConflictError(`workflow run ${existing.id} 缺少 external id，需要 reconcile 后再继续`);
    }
    const status = inspectStatusForRun(context, project, launcher, existing, runner);
    const updated = persistWorkflowStatus(context, existing, status, "workflow.status_inspected", "status");
    return { workflowRun: updated, status, reused: true };
  }

  let workflowLock: LockRecord | undefined;
  let operationId: string | undefined;
  let startingWorkflowRun: WorkflowRunRecord | undefined;
  let canMarkFailed = false;
  let sideEffectWindowStarted = false;
  try {
    const operation = createOperation(context, {
      idempotencyKey: workflowStartKey(attempt.id, input.profileId),
      kind: "workflow:start",
      projectId: project.id,
      taskId: attempt.taskId,
      attemptId: attempt.id
    });
    operationId = operation.id;
    assertStartOperationCanRun(operation.status);
    workflowLock = acquireLock(context, {
      resourceKind: "attempt-workflow",
      resourceId: attempt.id,
      owner,
      ttlMs,
      now
    });
    startingWorkflowRun = withTransaction(context, () => {
      updateOperation(context, {
        operationId: operation.id,
        status: "running",
        now,
        lastObservedState: { phase: "lock-acquired", profileId: input.profileId }
      });
      // 在真正启动 workflow 前先落库，避免 start 已发生但外层没有任何可恢复记录。
      return createWorkflowRun(context, {
        projectId: project.id,
        taskId: attempt.taskId,
        attemptId: attempt.id,
        profileId: input.profileId,
        status: "starting"
      });
    });
    canMarkFailed = true;

    // workflow protocol stdout 是本 adapter 的唯一输入边界；不扫描 `.workflow` 私有文件。
    sideEffectWindowStarted = true;
    const raw = runProtocolJson(project, workspace.repoPath, launcher, runner, [
      "protocol",
      "start",
      "--workflow",
      input.profileId
    ]);
    const startStatus = parseWorkflowStatus(raw, { fallbackLifecycle: "active" });
    const status = normalizeStartedStatus(startStatus, input.profileId);
    const coarseStatus = coarseWorkflowStatus(status);
    const lock = workflowLock;
    const workflowRunRecord = startingWorkflowRun;
    if (!workflowRunRecord) {
      throw new WorkflowProtocolError("workflow starting record missing");
    }
    const workflowRun = withTransaction(context, () => {
      const updated = updateWorkflowRun(context, {
        workflowRunId: workflowRunRecord.id,
        expectedStateVersion: workflowRunRecord.stateVersion,
        status: coarseStatus,
        externalId: status.runId,
        handoffKind: status.handoff.kind,
        lock: {
          resourceKind: "attempt-workflow",
          resourceId: attempt.id,
          lockToken: lock.lockToken,
          now
        }
      });
      appendEvent(context, {
        type: "workflow.started",
        summary: `workflow run started: ${updated.id}`,
        projectId: project.id,
        taskId: attempt.taskId,
        attemptId: attempt.id,
        workflowRunId: updated.id,
        operationId: operation.id,
        lockToken: lock.lockToken,
        payload: protocolStatusEventPayload(status, "start"),
        artifactRefs: status.handoff.artifacts.map((artifact) => artifact.path)
      });
      updateOperation(context, {
        operationId: operation.id,
        status: "succeeded",
        now,
        externalId: status.runId,
        lastObservedState: { phase: "workflow-started", runId: status.runId, status: coarseStatus }
      });
      return updated;
    });

    return { workflowRun, operationId: operation.id, status, reused: false };
  } catch (error) {
    if (operationId && canMarkFailed && (sideEffectWindowStarted || !(error instanceof ActiveResourceConflictError))) {
      updateOperation(context, {
        operationId,
        status: sideEffectWindowStarted ? "unknown" : "failed",
        now,
        failureCode: error instanceof Error ? error.name : "unknown",
        lastObservedState: { phase: "workflow-start-failed", error: error instanceof Error ? error.message : String(error) }
      });
    }
    throw error;
  } finally {
    if (workflowLock) {
      releaseLock(context, "attempt-workflow", attempt.id, workflowLock.lockToken);
    }
  }
}

export function inspectWorkflowRun(context: DbContext, input: InspectWorkflowRunInput): WorkflowRunResult {
  const workflowRun = requireWorkflowRunRecord(context, input.workflowRunId);
  const project = requireProjectRecord(context, workflowRun.projectId);
  const launcher = requireWorkflowLauncher(project);
  const status = inspectStatusForRun(context, project, launcher, workflowRun, input.runner ?? runWorkflowProtocol);
  const updated = persistWorkflowStatus(context, workflowRun, status, "workflow.status_inspected", "status");
  return { workflowRun: updated, status, reused: true };
}

export function invokeWorkflowAction(context: DbContext, input: InvokeWorkflowActionInput): WorkflowRunResult {
  const owner = input.owner ?? "workflow-adapter";
  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? 5 * 60 * 1000;
  const runner = input.runner ?? runWorkflowProtocol;
  const workflowRun = requireWorkflowRunRecord(context, input.workflowRunId);
  const action = requireNonEmpty(input.action, "action");
  const actionArg = input.arg === undefined ? undefined : requireNonEmpty(input.arg, "arg");
  if (workflowRun.stateVersion !== input.expectedStateVersion) {
    const existingOperation = getOperationByIdempotencyKey(
      context,
      workflowActionKey(workflowRun.id, input.expectedStateVersion, action, actionArg)
    );
    if (existingOperation?.status === "succeeded" || existingOperation?.status === "reconciled") {
      const project = requireProjectRecord(context, workflowRun.projectId);
      const launcher = requireWorkflowLauncher(project);
      const status = inspectStatusForRun(context, project, launcher, workflowRun, runner);
      return { workflowRun, operationId: existingOperation.id, status, reused: true };
    }
    throw new ActiveResourceConflictError(
      `workflow run ${workflowRun.id} state_version mismatch: expected ${input.expectedStateVersion}, actual ${workflowRun.stateVersion}`
    );
  }
  const project = requireProjectRecord(context, workflowRun.projectId);
  const launcher = requireWorkflowLauncher(project);
  const workspace = requireReadyWorkspace(context, workflowRun.attemptId);
  const args = ["protocol", "action", "--run", requireExternalRunId(workflowRun), action];
  if (actionArg !== undefined) {
    args.push(actionArg);
  }
  let workflowLock: LockRecord | undefined;
  let operationId: string | undefined;
  let canMarkFailed = false;
  let sideEffectWindowStarted = false;
  try {
    const operation = createOperation(context, {
      idempotencyKey: workflowActionKey(workflowRun.id, input.expectedStateVersion, action, actionArg),
      kind: "workflow:action",
      projectId: workflowRun.projectId,
      taskId: workflowRun.taskId,
      attemptId: workflowRun.attemptId,
      externalId: workflowRun.externalId
    });
    operationId = operation.id;
    assertActionOperationCanRun(operation.status);
    workflowLock = acquireLock(context, {
      resourceKind: "attempt-workflow",
      resourceId: workflowRun.attemptId,
      owner,
      ttlMs,
      now
    });
    updateOperation(context, {
      operationId: operation.id,
      status: "running",
      now,
      lastObservedState: { phase: "lock-acquired", workflowRunId: workflowRun.id, action }
    });
    canMarkFailed = true;

    sideEffectWindowStarted = true;
    const raw = runProtocolJson(project, workspace.repoPath, launcher, runner, args);
    const status = parseWorkflowStatus(raw);
    const updated = persistWorkflowStatus(context, workflowRun, status, "workflow.action", "action", {
      operationId: operation.id,
      lockToken: workflowLock.lockToken,
      updateLock: {
        resourceKind: "attempt-workflow",
        resourceId: workflowRun.attemptId,
        lockToken: workflowLock.lockToken,
        now
      },
      succeedOperation: {
        operationId: operation.id,
        now,
        externalId: status.runId,
        lastObservedState: { phase: "workflow-action-applied", runId: status.runId, status: coarseWorkflowStatus(status), action }
      }
    });
    return { workflowRun: updated, operationId: operation.id, status, reused: false };
  } catch (error) {
    if (operationId && canMarkFailed && (sideEffectWindowStarted || !(error instanceof ActiveResourceConflictError))) {
      updateOperation(context, {
        operationId,
        status: sideEffectWindowStarted ? "unknown" : "failed",
        now,
        failureCode: error instanceof Error ? error.name : "unknown",
        lastObservedState: { phase: "workflow-action-failed", error: error instanceof Error ? error.message : String(error), action }
      });
    }
    throw error;
  } finally {
    if (workflowLock) {
      releaseLock(context, "attempt-workflow", workflowRun.attemptId, workflowLock.lockToken);
    }
  }
}

export function listWorkflowArtifacts(context: DbContext, input: ListWorkflowArtifactsInput): WorkflowArtifacts {
  const workflowRun = requireWorkflowRunRecord(context, input.workflowRunId);
  const project = requireProjectRecord(context, workflowRun.projectId);
  const workspace = requireReadyWorkspace(context, workflowRun.attemptId);
  const raw = runProtocolJson(project, workspace.repoPath, requireWorkflowLauncher(project), input.runner ?? runWorkflowProtocol, [
    "protocol",
    "artifacts",
    "--run",
    requireExternalRunId(workflowRun)
  ]);
  const artifacts = parseWorkflowArtifacts(raw);
  appendEvent(context, {
    type: "workflow.artifacts_inspected",
    summary: `workflow artifacts inspected: ${workflowRun.id}`,
    projectId: workflowRun.projectId,
    taskId: workflowRun.taskId,
    attemptId: workflowRun.attemptId,
    workflowRunId: workflowRun.id,
    artifactRefs: artifacts.artifacts.map((artifact) => artifact.path),
    payload: {
      workflowRunId: workflowRun.id,
      externalRunId: artifacts.runId,
      artifactRoot: artifacts.artifactRoot,
      artifacts: artifacts.artifacts
    }
  });
  return artifacts;
}

export function listWorkflowEvents(context: DbContext, input: ListWorkflowEventsInput): WorkflowEvents {
  const workflowRun = requireWorkflowRunRecord(context, input.workflowRunId);
  const project = requireProjectRecord(context, workflowRun.projectId);
  const workspace = requireReadyWorkspace(context, workflowRun.attemptId);
  const raw = runProtocolJson(project, workspace.repoPath, requireWorkflowLauncher(project), input.runner ?? runWorkflowProtocol, [
    "protocol",
    "events",
    "--run",
    requireExternalRunId(workflowRun)
  ]);
  const events = parseWorkflowEvents(raw);
  appendEvent(context, {
    type: "workflow.events_inspected",
    summary: `workflow events inspected: ${workflowRun.id}`,
    projectId: workflowRun.projectId,
    taskId: workflowRun.taskId,
    attemptId: workflowRun.attemptId,
    workflowRunId: workflowRun.id,
    payload: {
      workflowRunId: workflowRun.id,
      externalRunId: events.runId,
      eventsPath: events.eventsPath,
      latest: events.latest
    }
  });
  return events;
}

function readCapabilities(project: ProjectRecord, cwd: string, runner: WorkflowProtocolRunner): WorkflowCapabilities {
  const raw = runProtocolJson(project, cwd, requireWorkflowLauncher(project), runner, ["protocol", "capabilities"]);
  return parseWorkflowCapabilities(raw);
}

function inspectStatusForRun(
  context: DbContext,
  project: ProjectRecord,
  launcher: string,
  workflowRun: WorkflowRunRecord,
  runner: WorkflowProtocolRunner
): WorkflowStatus {
  const workspace = requireReadyWorkspace(context, workflowRun.attemptId);
  const raw = runProtocolJson(project, workspace.repoPath, launcher, runner, [
    "protocol",
    "status",
    "--run",
    requireExternalRunId(workflowRun)
  ]);
  const status = parseWorkflowStatus(raw);
  assertProtocolStatusMatchesRun(workflowRun, status);
  return status;
}

function persistWorkflowStatus(
  context: DbContext,
  workflowRun: WorkflowRunRecord,
  status: WorkflowStatus,
  eventType: string,
  command: string,
  options: {
    operationId?: string;
    lockToken?: string;
    updateLock?: {
      resourceKind: string;
      resourceId: string;
      lockToken: string;
      now?: Date;
    };
    succeedOperation?: {
      operationId: string;
      now: Date;
      externalId?: string;
      lastObservedState: unknown;
    };
  } = {}
): WorkflowRunRecord {
  const coarseStatus = coarseWorkflowStatus(status);
  return withTransaction(context, () => {
    const updated = updateWorkflowRun(context, {
      workflowRunId: workflowRun.id,
      expectedStateVersion: workflowRun.stateVersion,
      status: coarseStatus,
      externalId: status.runId,
      handoffKind: status.handoff.kind,
      lock: options.updateLock
    });
    appendEvent(context, {
      type: eventType,
      summary: `${eventType}: ${updated.id}`,
      projectId: updated.projectId,
      taskId: updated.taskId,
      attemptId: updated.attemptId,
      workflowRunId: updated.id,
      operationId: options.operationId,
      lockToken: options.lockToken,
      severity: coarseStatus === "failed" || coarseStatus === "unknown" ? "warn" : "info",
      artifactRefs: status.handoff.artifacts.map((artifact) => artifact.path),
      payload: protocolStatusEventPayload(status, command)
    });
    if (options.succeedOperation) {
      updateOperation(context, {
        operationId: options.succeedOperation.operationId,
        status: "succeeded",
        now: options.succeedOperation.now,
        externalId: options.succeedOperation.externalId,
        lastObservedState: options.succeedOperation.lastObservedState
      });
    }
    return updated;
  });
}

function assertProtocolStatusMatchesRun(workflowRun: WorkflowRunRecord, status: WorkflowStatus): void {
  if (status.runId !== workflowRun.externalId) {
    throw new WorkflowProtocolError("workflow protocol runId mismatch");
  }
  if (status.profile && status.profile !== workflowRun.profileId) {
    throw new WorkflowProtocolError("workflow protocol profile mismatch");
  }
}

function parseWorkflowCapabilities(value: unknown): WorkflowCapabilities {
  const object = requireObject(value, "capabilities");
  const protocolVersion = requireString(object.protocolVersion, "protocolVersion");
  if (protocolVersion !== "1") {
    throw new WorkflowProtocolError(`不兼容的 workflow protocolVersion：${protocolVersion}`);
  }
  const profiles = requireArray(object.profiles, "profiles").map((profile, index) => {
    const profileObject = requireObject(profile, `profiles[${index}]`);
    return {
      id: requireString(profileObject.id, `profiles[${index}].id`),
      purpose: requireString(profileObject.purpose, `profiles[${index}].purpose`),
      implemented: requireBoolean(profileObject.implemented, `profiles[${index}].implemented`)
    };
  });
  const commands = optionalStringArray(object.commands, "commands");
  const handoffKinds = optionalStringArray(object.handoffKinds, "handoffKinds").map(assertHandoffKind);
  return { protocolVersion: "1", profiles, commands, handoffKinds };
}

function parseWorkflowStatus(value: unknown, options: { fallbackLifecycle?: WorkflowLifecycle } = {}): WorkflowStatus {
  const object = requireObject(value, "status");
  const runId = requireString(object.runId, "runId");
  const lifecycle = parseLifecycle(optionalString(object.lifecycle), options.fallbackLifecycle ?? "active");
  const handoff = parseHandoff(object.handoff);
  return {
    runId,
    profile: optionalString(object.profile),
    lifecycle,
    summary: optionalString(object.summary) ?? optionalString(object.status),
    handoff,
    artifactRoot: optionalString(object.artifactRoot),
    debug: {
      stage: optionalString(object.stage),
      substate: optionalString(object.substate),
      gate: object.gate,
      allowedActions: optionalStringArray(object.allowedActions, "allowedActions"),
      deniedActions: optionalStringArray(object.deniedActions, "deniedActions"),
      currentChange: object.currentChange,
      eventLog: optionalString(object.eventLog)
    }
  };
}

function parseWorkflowArtifacts(value: unknown): WorkflowArtifacts {
  const object = requireObject(value, "artifacts");
  return {
    runId: requireString(object.runId, "runId"),
    artifactRoot: optionalString(object.artifactRoot),
    artifacts: parseArtifactList(object.artifacts)
  };
}

function parseWorkflowEvents(value: unknown): WorkflowEvents {
  const object = requireObject(value, "events");
  const latest = requireArray(object.latest ?? [], "latest").map((event, index) => {
    const eventObject = requireObject(event, `latest[${index}]`);
    return {
      timestamp: optionalString(eventObject.timestamp),
      type: requireString(eventObject.type, `latest[${index}].type`),
      summary: requireString(eventObject.summary, `latest[${index}].summary`)
    };
  });
  return {
    runId: requireString(object.runId, "runId"),
    eventsPath: optionalString(object.eventsPath),
    latest
  };
}

function parseHandoff(value: unknown): WorkflowHandoff {
  if (value === undefined || value === null) {
    return { available: false, artifacts: [], deniedActions: [] };
  }
  const object = requireObject(value, "handoff");
  const available = Boolean(object.available);
  const rawKind = optionalString(object.kind);
  const kind = rawKind ? assertHandoffKind(rawKind) : undefined;
  if (available && !kind) {
    throw new WorkflowProtocolError("handoff.available=true 时必须提供 handoff.kind");
  }
  return {
    available,
    kind,
    reason: optionalString(object.reason),
    artifacts: parseArtifactList(object.artifacts),
    nextStep: parseOptionalActionGuidance(object.nextStep),
    deniedActions: optionalStringArray(object.deniedActions, "handoff.deniedActions"),
    recovery: parseOptionalActionGuidance(object.recovery)
  };
}

function parseArtifactList(value: unknown): WorkflowHandoff["artifacts"] {
  return requireArray(value ?? [], "artifacts").map((artifact, index) => {
    const artifactObject = requireObject(artifact, `artifacts[${index}]`);
    return {
      kind: optionalString(artifactObject.kind),
      path: requireString(artifactObject.path, `artifacts[${index}].path`),
      requiredForHandoff:
        artifactObject.requiredForHandoff === undefined
          ? undefined
          : requireBoolean(artifactObject.requiredForHandoff, `artifacts[${index}].requiredForHandoff`)
    };
  });
}

function parseOptionalActionGuidance(value: unknown): { action?: string; guidance?: string } | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const object = requireObject(value, "actionGuidance");
  return {
    action: optionalString(object.action),
    guidance: optionalString(object.guidance)
  };
}

function normalizeStartedStatus(status: WorkflowStatus, requestedProfile: string): WorkflowStatus {
  return {
    ...status,
    profile: status.profile ?? requestedProfile,
    summary: status.summary ?? "workflow run started"
  };
}

function coarseWorkflowStatus(status: WorkflowStatus): string {
  if (status.handoff.available) {
    return "handoff";
  }
  if (status.lifecycle === "failed") {
    return "failed";
  }
  if (status.lifecycle === "unknown") {
    return "unknown";
  }
  if (status.lifecycle === "completed") {
    return "completed";
  }
  return "running";
}

function protocolStatusEventPayload(status: WorkflowStatus, command: string): unknown {
  return {
    command,
    runId: status.runId,
    profile: status.profile,
    lifecycle: status.lifecycle,
    summary: status.summary,
    handoff: status.handoff,
    artifactRoot: status.artifactRoot,
    // debug 字段只服务观测和排查，不能被外层状态机当成完成语义。
    debug: status.debug
  };
}

function runProtocolJson(
  _project: ProjectRecord,
  cwd: string,
  launcher: string,
  runner: WorkflowProtocolRunner,
  args: string[]
): unknown {
  if (!existsSync(cwd)) {
    throw new WorkflowProtocolError(`workflow cwd 不存在：${cwd}`);
  }
  const output = runner(args, { cwd, launcher, timeoutMs: DEFAULT_PROTOCOL_TIMEOUT_MS });
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new WorkflowProtocolError("workflow protocol 输出不是合法 JSON");
  }
}

function runWorkflowProtocol(args: string[], options: { cwd: string; launcher: string; timeoutMs: number }): string {
  return execFileSync(options.launcher, args, {
    cwd: options.cwd,
    encoding: "utf8",
    timeout: options.timeoutMs
  });
}

function assertImplementedProfile(capabilities: WorkflowCapabilities, profileId: string): void {
  const profile = capabilities.profiles.find((candidate) => candidate.id === profileId);
  if (!profile || !profile.implemented) {
    throw new WorkflowProtocolError(`workflow profile 未实现或不存在：${profileId}`);
  }
}

function assertStartOperationCanRun(status: string): void {
  if (status === "running" || status === "unknown") {
    throw new ActiveResourceConflictError(`workflow start operation requires reconcile before retry: ${status}`);
  }
  if (status === "succeeded" || status === "reconciled" || status === "canceled") {
    throw new WorkflowProtocolError(`operation is terminal: ${status}`);
  }
}

function assertActionOperationCanRun(status: string): void {
  if (status === "running" || status === "unknown") {
    throw new ActiveResourceConflictError(`workflow action operation requires reconcile before retry: ${status}`);
  }
  if (status === "succeeded" || status === "reconciled" || status === "canceled") {
    throw new WorkflowProtocolError(`operation is terminal: ${status}`);
  }
}

function assertHandoffKind(kind: string): WorkflowHandoffKind {
  if (
    kind === "pr_ready" ||
    kind === "human_review_required" ||
    kind === "manual_handoff" ||
    kind === "blocked" ||
    kind === "completed_no_pr"
  ) {
    return kind;
  }
  throw new WorkflowProtocolError(`不支持的 workflow handoff kind：${kind}`);
}

function parseLifecycle(value: string | undefined, fallback: WorkflowLifecycle): WorkflowLifecycle {
  const lifecycle = value ?? fallback;
  if (lifecycle === "active" || lifecycle === "completed" || lifecycle === "failed" || lifecycle === "unknown") {
    return lifecycle;
  }
  throw new WorkflowProtocolError(`不支持的 workflow lifecycle：${lifecycle}`);
}

function requireReadyWorkspace(context: DbContext, attemptId: string) {
  const workspace = getActiveWorkspaceByAttempt(context, attemptId);
  if (!workspace || workspace.status !== "ready") {
    throw new WorkflowProtocolError(`attempt ${attemptId} 缺少 ready workspace`);
  }
  const repoPath = workspace.repoPath;
  if (!repoPath) {
    throw new WorkflowProtocolError(`workspace ${workspace.id} 缺少 repoPath`);
  }
  return { ...workspace, repoPath };
}

function requireWorkflowLauncher(project: ProjectRecord): string {
  const launcher = project.workflowLauncher?.trim();
  if (!launcher) {
    throw new WorkflowProtocolError(`project ${project.id} 缺少 workflowLauncher`);
  }
  return launcher;
}

function requireProjectRepoPath(project: ProjectRecord): string {
  if (!project.repoPath) {
    throw new WorkflowProtocolError(`project ${project.id} 缺少 repoPath`);
  }
  return project.repoPath;
}

function requireExternalRunId(workflowRun: WorkflowRunRecord): string {
  if (!workflowRun.externalId) {
    throw new WorkflowProtocolError(`workflow run ${workflowRun.id} 缺少 external run id`);
  }
  return workflowRun.externalId;
}

function requireProjectRecord(context: DbContext, projectId: string): ProjectRecord {
  const project = getProject(context, projectId);
  if (!project) {
    throw new WorkflowProtocolError(`project not found: ${projectId}`);
  }
  return project;
}

function requireAttemptRecord(context: DbContext, attemptId: string): AttemptRecord {
  const attempt = getAttempt(context, attemptId);
  if (!attempt) {
    throw new WorkflowProtocolError(`attempt not found: ${attemptId}`);
  }
  return attempt;
}

function requireWorkflowRunRecord(context: DbContext, workflowRunId: string): WorkflowRunRecord {
  const workflowRun = getWorkflowRun(context, workflowRunId);
  if (!workflowRun) {
    throw new WorkflowProtocolError(`workflow run not found: ${workflowRunId}`);
  }
  return workflowRun;
}

function workflowStartKey(attemptId: string, profileId: string): string {
  return `workflow:start:${attemptId}:${profileId}`;
}

function workflowActionKey(workflowRunId: string, stateVersion: number, action: string, arg?: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({ workflowRunId, stateVersion, action, arg: arg ?? null }))
    .digest("hex")
    .slice(0, 32);
  return `workflow:action:${workflowRunId}:v${stateVersion}:${digest}`;
}

function requireNonEmpty(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new WorkflowProtocolError(`${fieldName} 不能为空`);
  }
  return normalized;
}

function requireObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkflowProtocolError(`${fieldName} 必须是 object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new WorkflowProtocolError(`${fieldName} 必须是 array`);
  }
  return value;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WorkflowProtocolError(`${fieldName} 必须是非空 string`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new WorkflowProtocolError(`${fieldName} 必须是 boolean`);
  }
  return value;
}

function optionalStringArray(value: unknown, fieldName: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  return requireArray(value, fieldName).map((item, index) => requireString(item, `${fieldName}[${index}]`));
}
