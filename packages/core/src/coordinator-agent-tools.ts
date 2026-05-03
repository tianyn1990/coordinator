import { existsSync, mkdirSync, realpathSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import {
  appendEvent,
  createArtifact,
  createAttempt,
  createExecutionPlan,
  createHumanRequest,
  getProject,
  getTask,
  getWorkflowRun,
  updateTaskStatus,
  withTransaction,
  type DbContext
} from "@coordinator/db";
import { buildTaskSurfaceFromDb, type SurfaceEnvelope } from "./surface.js";
import {
  createAttemptWorkspace,
  type CreateAttemptWorkspaceInput,
  type WorkspaceManagerResult
} from "./workspace-manager.js";
import {
  inspectWorkflowRun,
  startWorkflowRun,
  type InspectWorkflowRunInput,
  type StartWorkflowRunInput,
  type WorkflowRunResult
} from "./workflow-protocol-adapter.js";
import {
  createPullRequestRuntime,
  inspectPullRequestReviewRuntime,
  mergeAfterApprovalRuntime,
  requestMergeApprovalRuntime,
  updatePullRequestRuntime,
  type PullRequestProvider,
  type PullRequestProviderRunner
} from "./pr-mr-provider.js";

const MAX_ARTIFACT_BYTES = 256 * 1024;

export type CoordinatorAgentToolName =
  | "write_execution_plan"
  | "revise_execution_plan"
  | "create_attempt"
  | "create_workspace"
  | "start_workflow_run"
  | "inspect_workflow_run"
  | "ask_human"
  | "create_pr"
  | "update_pr"
  | "inspect_review"
  | "request_merge_approval"
  | "merge_after_approval";

export type CoordinatorAgentToolArgs = Record<string, string | undefined>;

export type ExecuteCoordinatorAgentToolInput = {
  taskId: string;
  toolName: CoordinatorAgentToolName | string;
  args?: CoordinatorAgentToolArgs;
  actor?: string;
  agentSessionId?: string;
  workspace?: Pick<CreateAttemptWorkspaceInput, "worker" | "ttlMs" | "now" | "gitRunner">;
  workflowStart?: Pick<StartWorkflowRunInput, "ttlMs" | "now" | "runner">;
  workflowInspect?: Pick<InspectWorkflowRunInput, "runner">;
  pullRequest?: {
    provider?: PullRequestProvider;
    providerRunner?: PullRequestProviderRunner;
  };
};

export type CoordinatorAgentToolResult = {
  toolName: string;
  status: "succeeded" | "failed";
  failureCode?: CoordinatorAgentToolFailureCode;
  surfaceId: string;
  result?: SanitizedToolOutput;
  artifactRefs: string[];
};

export type SanitizedToolOutput = {
  kind: string;
  id?: string;
  status?: string;
  artifactPath?: string;
  reused?: boolean;
  handoffKind?: string;
  url?: string;
  nextStep: string;
};

export type CoordinatorAgentToolFailureCode =
  | "not_allowed_in_current_state"
  | "missing_argument"
  | "invalid_argument"
  | "missing_artifact"
  | "invalid_artifact_path"
  | "tool_execution_failed";

export class CoordinatorAgentToolError extends Error {
  constructor(
    message: string,
    public readonly code: CoordinatorAgentToolFailureCode
  ) {
    super(message);
    this.name = "CoordinatorAgentToolError";
  }
}

export function executeCoordinatorAgentTool(
  context: DbContext,
  input: ExecuteCoordinatorAgentToolInput
): CoordinatorAgentToolResult {
  const actor = normalizeShortString(input.actor ?? "coordinator-agent", "actor");
  const args = input.args ?? {};
  const surface = buildTaskSurfaceFromDb(context, input.taskId);
  const artifactRefs: string[] = [];
  try {
    assertToolVisible(surface, input.toolName);
    const rawResult = executeVisibleTool(context, surface, {
      ...input,
      args,
      actor
    }, artifactRefs);
    const result = sanitizeToolOutput(input.toolName, rawResult);
    appendToolEvent(context, {
      input,
      surface,
      actor,
      status: "succeeded",
      resultSummary: result,
      artifactRefs
    });
    return {
      toolName: input.toolName,
      status: "succeeded",
      surfaceId: surface.surfaceId,
      result,
      artifactRefs
    };
  } catch (error) {
    const failure =
      error instanceof CoordinatorAgentToolError
        ? error
        : new CoordinatorAgentToolError(error instanceof Error ? error.message : String(error), "tool_execution_failed");
    appendToolEvent(context, {
      input,
      surface,
      actor,
      status: "failed",
      failureCode: failure.code,
      failureMessage: failure.message,
      artifactRefs
    });
    throw failure;
  }
}

function executeVisibleTool(
  context: DbContext,
  surface: SurfaceEnvelope,
  input: ExecuteCoordinatorAgentToolInput & { args: CoordinatorAgentToolArgs; actor: string },
  artifactRefs: string[]
): unknown {
  switch (input.toolName) {
    case "write_execution_plan":
      return writeExecutionPlan(context, surface, input, "active", artifactRefs);
    case "revise_execution_plan":
      return writeExecutionPlan(context, surface, input, "revised", artifactRefs);
    case "create_attempt":
      return createAttemptFromTool(context, surface, input);
    case "create_workspace":
      return createWorkspaceFromTool(context, surface, input);
    case "start_workflow_run":
      return startWorkflowRunFromTool(context, surface, input);
    case "inspect_workflow_run":
      return inspectWorkflowRunFromTool(context, surface, input);
    case "ask_human":
      return askHumanFromTool(context, surface, input, artifactRefs);
    case "create_pr":
      return createPullRequestFromTool(context, input, artifactRefs);
    case "update_pr":
      return updatePullRequestFromTool(context, input, artifactRefs);
    case "inspect_review":
      return inspectReviewFromTool(context, input);
    case "request_merge_approval":
      return requestMergeApprovalFromTool(context, input, artifactRefs);
    case "merge_after_approval":
      return mergeAfterApprovalFromTool(context, input);
    default:
      throw new CoordinatorAgentToolError(`不支持的 agent tool：${input.toolName}`, "invalid_argument");
  }
}

function writeExecutionPlan(
  context: DbContext,
  surface: SurfaceEnvelope,
  input: ExecuteCoordinatorAgentToolInput & { args: CoordinatorAgentToolArgs; actor: string },
  status: "active" | "revised",
  artifactRefs: string[]
): { executionPlanId: string; artifactPath: string; status: string } {
  const task = requireTaskForSurface(context, surface);
  const artifact = readToolArtifact(surface, requireArg(input.args, "artifact"), artifactRefs);
  const reason = status === "revised" ? normalizeShortString(input.args.reason ?? "plan-revision", "reason") : undefined;
  const latestAttemptId = surface.json.attempt?.id ?? undefined;

  const plan = withTransaction(context, () => {
    const created = createExecutionPlan(context, {
      projectId: task.projectId,
      taskId: task.id,
      attemptId: latestAttemptId,
      status,
      artifactPath: artifact.relativePath
    });
    createArtifact(context, {
      projectId: task.projectId,
      taskId: task.id,
      attemptId: latestAttemptId,
      kind: status === "active" ? "execution-plan" : "execution-plan-revision",
      owner: input.actor,
      path: artifact.relativePath
    });
    if (task.status === "created" || task.status === "planning") {
      updateTaskStatus(context, task.id, task.stateVersion, "planning");
    }
    appendEvent(context, {
      type: status === "active" ? "agent_tool.execution_plan_written" : "agent_tool.execution_plan_revised",
      summary: `${input.toolName} persisted execution plan`,
      projectId: task.projectId,
      taskId: task.id,
      attemptId: latestAttemptId,
      agentSessionId: input.agentSessionId,
      payload: {
        executionPlanId: created.id,
        artifactPath: artifact.relativePath,
        preview: previewText(artifact.content),
        reason
      },
      artifactRefs: [artifact.relativePath]
    });
    return created;
  });

  return { executionPlanId: plan.id, artifactPath: artifact.relativePath, status: plan.status };
}

function createAttemptFromTool(
  context: DbContext,
  surface: SurfaceEnvelope,
  input: ExecuteCoordinatorAgentToolInput & { args: CoordinatorAgentToolArgs; actor: string }
): { attemptId: string; status: string; reason: string } {
  const task = requireTaskForSurface(context, surface);
  const reason = normalizeShortString(input.args.reason ?? "initial", "reason");
  const attempt = createAttempt(context, {
    projectId: task.projectId,
    taskId: task.id,
    reason
  });
  return { attemptId: attempt.id, status: attempt.status, reason: attempt.reason };
}

function createWorkspaceFromTool(
  context: DbContext,
  surface: SurfaceEnvelope,
  input: ExecuteCoordinatorAgentToolInput & { args: CoordinatorAgentToolArgs; actor: string }
): WorkspaceManagerResult {
  const attemptId = requireArg(input.args, "attempt");
  if (surface.json.attempt?.id && surface.json.attempt.id !== attemptId) {
    throw new CoordinatorAgentToolError(`attempt 不匹配当前 surface：${attemptId}`, "invalid_argument");
  }
  return createAttemptWorkspace(context, {
    attemptId,
    owner: input.actor,
    worker: input.workspace?.worker,
    ttlMs: input.workspace?.ttlMs,
    now: input.workspace?.now,
    gitRunner: input.workspace?.gitRunner
  });
}

function startWorkflowRunFromTool(
  context: DbContext,
  surface: SurfaceEnvelope,
  input: ExecuteCoordinatorAgentToolInput & { args: CoordinatorAgentToolArgs; actor: string }
): WorkflowRunResult {
  const attemptId = requireCurrentAttempt(surface);
  const profileId = requireArg(input.args, "profile");
  if (input.args.provider !== undefined) {
    throw new CoordinatorAgentToolError("start_workflow_run 当前不接受 provider 参数；inner provider 由 workflow/project 配置决定", "invalid_argument");
  }
  return startWorkflowRun(context, {
    attemptId,
    profileId,
    owner: input.actor,
    ttlMs: input.workflowStart?.ttlMs,
    now: input.workflowStart?.now,
    runner: input.workflowStart?.runner
  });
}

function inspectWorkflowRunFromTool(
  context: DbContext,
  surface: SurfaceEnvelope,
  input: ExecuteCoordinatorAgentToolInput & { args: CoordinatorAgentToolArgs; actor: string }
): WorkflowRunResult {
  const workflowRunId = requireArg(input.args, "run");
  const run = getWorkflowRun(context, workflowRunId);
  if (!run || run.taskId !== surface.json.task.id) {
    throw new CoordinatorAgentToolError(`workflow run 不属于当前 task：${workflowRunId}`, "invalid_argument");
  }
  return inspectWorkflowRun(context, {
    workflowRunId,
    runner: input.workflowInspect?.runner
  });
}

function askHumanFromTool(
  context: DbContext,
  surface: SurfaceEnvelope,
  input: ExecuteCoordinatorAgentToolInput & { args: CoordinatorAgentToolArgs; actor: string },
  artifactRefs: string[]
): { humanRequestId: string; kind: string; status: string; questionArtifactPath: string } {
  const task = requireTaskForSurface(context, surface);
  const kind = normalizeShortString(requireArg(input.args, "kind"), "kind");
  const artifact = readToolArtifact(surface, requireArg(input.args, "artifact"), artifactRefs);
  const attemptId = surface.json.attempt?.id ?? undefined;
  const blockedKey = `agent:${kind}:${attemptId ?? task.id}`;
  const request = withTransaction(context, () => {
    const created = createHumanRequest(context, {
      projectId: task.projectId,
      taskId: task.id,
      attemptId,
      blockedKey,
      kind,
      status: "pending",
      questionArtifactPath: artifact.relativePath
    });
    createArtifact(context, {
      projectId: task.projectId,
      taskId: task.id,
      attemptId,
      kind: "human-question",
      owner: input.actor,
      path: artifact.relativePath
    });
    updateTaskStatus(context, task.id, task.stateVersion, "waiting_human");
    return created;
  });
  return {
    humanRequestId: request.id,
    kind: request.kind,
    status: request.status,
    questionArtifactPath: artifact.relativePath
  };
}

function createPullRequestFromTool(
  context: DbContext,
  input: ExecuteCoordinatorAgentToolInput & { args: CoordinatorAgentToolArgs; actor: string },
  artifactRefs: string[]
) {
  const artifact = requireArg(input.args, "body-artifact");
  readToolArtifact(buildTaskSurfaceFromDb(context, input.taskId), artifact, artifactRefs);
  return createPullRequestRuntime(context, {
    taskId: input.taskId,
    title: normalizeShortString(requireArg(input.args, "title"), "title"),
    bodyArtifact: artifact,
    actor: input.actor,
    provider: input.pullRequest?.provider,
    providerRunner: input.pullRequest?.providerRunner
  });
}

function updatePullRequestFromTool(
  context: DbContext,
  input: ExecuteCoordinatorAgentToolInput & { args: CoordinatorAgentToolArgs; actor: string },
  artifactRefs: string[]
) {
  const bodyArtifact = input.args["body-artifact"];
  if (bodyArtifact) {
    readToolArtifact(buildTaskSurfaceFromDb(context, input.taskId), bodyArtifact, artifactRefs);
  }
  return updatePullRequestRuntime(context, {
    taskId: input.taskId,
    prId: requireArg(input.args, "pr"),
    title: input.args.title ? normalizeShortString(input.args.title, "title") : undefined,
    bodyArtifact,
    actor: input.actor,
    provider: input.pullRequest?.provider,
    providerRunner: input.pullRequest?.providerRunner
  });
}

function inspectReviewFromTool(
  context: DbContext,
  input: ExecuteCoordinatorAgentToolInput & { args: CoordinatorAgentToolArgs; actor: string }
) {
  return inspectPullRequestReviewRuntime(context, {
    taskId: input.taskId,
    prId: requireArg(input.args, "pr"),
    actor: input.actor,
    provider: input.pullRequest?.provider,
    providerRunner: input.pullRequest?.providerRunner
  });
}

function requestMergeApprovalFromTool(
  context: DbContext,
  input: ExecuteCoordinatorAgentToolInput & { args: CoordinatorAgentToolArgs; actor: string },
  artifactRefs: string[]
) {
  const artifact = requireArg(input.args, "artifact");
  readToolArtifact(buildTaskSurfaceFromDb(context, input.taskId), artifact, artifactRefs);
  return requestMergeApprovalRuntime(context, {
    taskId: input.taskId,
    prId: requireArg(input.args, "pr"),
    bodyArtifact: artifact,
    actor: input.actor
  });
}

function mergeAfterApprovalFromTool(
  context: DbContext,
  input: ExecuteCoordinatorAgentToolInput & { args: CoordinatorAgentToolArgs; actor: string }
) {
  return mergeAfterApprovalRuntime(context, {
    taskId: input.taskId,
    prId: requireArg(input.args, "pr"),
    actor: input.actor,
    provider: input.pullRequest?.provider,
    providerRunner: input.pullRequest?.providerRunner
  });
}

function assertToolVisible(surface: SurfaceEnvelope, toolName: string): void {
  if (!surface.json.available_tools.some((tool) => tool.name === toolName)) {
    throw new CoordinatorAgentToolError(`当前 surface 不允许调用工具：${toolName}`, "not_allowed_in_current_state");
  }
}

function readToolArtifact(
  surface: SurfaceEnvelope,
  inputPath: string,
  artifactRefs: string[]
): { relativePath: string; absolutePath: string; content: string } {
  const relativePath = validateArtifactRelativePath(inputPath);
  const root = resolve(surface.json.artifact_root);
  mkdirSync(root, { recursive: true });
  const rootReal = realpathSync(root);
  const absolutePath = resolve(rootReal, relativePath);
  if (!existsSync(absolutePath)) {
    throw new CoordinatorAgentToolError(`artifact 不存在：${relativePath}`, "missing_artifact");
  }
  const realPath = realpathSync(absolutePath);
  if (!isPathInside(rootReal, realPath)) {
    throw new CoordinatorAgentToolError(`artifact path 逃逸 root：${inputPath}`, "invalid_artifact_path");
  }
  const stat = statSync(realPath);
  if (!stat.isFile()) {
    throw new CoordinatorAgentToolError(`artifact 不是文件：${relativePath}`, "missing_artifact");
  }
  if (stat.size > MAX_ARTIFACT_BYTES) {
    throw new CoordinatorAgentToolError(`artifact 超过大小限制：${relativePath}`, "invalid_argument");
  }
  const content = readFileSync(realPath, "utf8");
  artifactRefs.push(relativePath);
  return { relativePath, absolutePath: realPath, content };
}

function validateArtifactRelativePath(inputPath: string): string {
  const trimmed = normalizeShortString(inputPath, "artifact");
  if (isAbsolute(trimmed)) {
    throw new CoordinatorAgentToolError("artifact path 不允许绝对路径", "invalid_artifact_path");
  }
  const segments = trimmed.split(/[\\/]+/);
  if (segments.some((segment) => segment === ".." || segment === "")) {
    throw new CoordinatorAgentToolError("artifact path 不允许空 segment 或 ..", "invalid_artifact_path");
  }
  const normalized = normalize(trimmed);
  if (normalized === "." || normalized.startsWith(`..${sep}`) || normalized === "..") {
    throw new CoordinatorAgentToolError("artifact path 不允许逃逸 root", "invalid_artifact_path");
  }
  return normalized;
}

function requireTaskForSurface(context: DbContext, surface: SurfaceEnvelope) {
  const task = getTask(context, surface.json.task.id);
  if (!task) {
    throw new CoordinatorAgentToolError(`task not found: ${surface.json.task.id}`, "invalid_argument");
  }
  const project = getProject(context, task.projectId);
  if (!project) {
    throw new CoordinatorAgentToolError(`project not found: ${task.projectId}`, "invalid_argument");
  }
  return task;
}

function requireCurrentAttempt(surface: SurfaceEnvelope): string {
  const attemptId = surface.json.attempt?.id;
  if (!attemptId) {
    throw new CoordinatorAgentToolError("当前 surface 没有 attempt", "invalid_argument");
  }
  return attemptId;
}

function requireArg(args: CoordinatorAgentToolArgs, name: string): string {
  const value = args[name];
  if (!value) {
    throw new CoordinatorAgentToolError(`缺少工具参数：${name}`, "missing_argument");
  }
  return normalizeShortString(value, name);
}

function normalizeShortString(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new CoordinatorAgentToolError(`${fieldName} 不能为空`, "invalid_argument");
  }
  if (trimmed.length > 256) {
    throw new CoordinatorAgentToolError(`${fieldName} 过长`, "invalid_argument");
  }
  return trimmed;
}

function appendToolEvent(
  context: DbContext,
  input: {
    input: ExecuteCoordinatorAgentToolInput;
    surface: SurfaceEnvelope;
    actor: string;
    status: "succeeded" | "failed";
    resultSummary?: unknown;
    failureCode?: CoordinatorAgentToolFailureCode;
    failureMessage?: string;
    artifactRefs: string[];
  }
): void {
  appendEvent(context, {
    type: "agent_tool_call",
    summary: `${input.input.toolName} ${input.status}`,
    projectId: input.surface.json.project.id,
    taskId: input.surface.json.task.id,
    attemptId: input.surface.json.attempt?.id ?? undefined,
    agentSessionId: input.input.agentSessionId,
    payload: {
      toolName: input.input.toolName,
      actor: input.actor,
      argsSummary: summarizeArgs(input.input.args ?? {}),
      status: input.status,
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
      resultSummary: input.resultSummary,
      surfaceId: input.surface.surfaceId
    },
    artifactRefs: input.artifactRefs,
    severity: input.status === "failed" ? "warn" : "info"
  });
}

function summarizeArgs(args: CoordinatorAgentToolArgs): Record<string, string> {
  const summary: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue;
    summary[key] = value.length > 120 ? `${value.slice(0, 117)}...` : value;
  }
  return summary;
}

function sanitizeToolOutput(toolName: string, result: unknown): SanitizedToolOutput {
  if (toolName === "write_execution_plan" || toolName === "revise_execution_plan") {
    const value = result as { executionPlanId: string; artifactPath: string; status: string };
    return {
      kind: "execution_plan",
      id: value.executionPlanId,
      status: value.status,
      artifactPath: value.artifactPath,
      nextStep: "重新读取 surface，并按 available tools 推进下一步。"
    };
  }
  if (toolName === "create_attempt") {
    const value = result as { attemptId: string; status: string };
    return {
      kind: "attempt",
      id: value.attemptId,
      status: value.status,
      nextStep: "重新读取 surface，确认 create_workspace 是否可见。"
    };
  }
  if (toolName === "create_workspace") {
    const value = result as WorkspaceManagerResult;
    return {
      kind: "workspace",
      id: value.workspace.id,
      status: value.workspace.status,
      reused: value.reused,
      nextStep: "重新读取 surface，确认 start_workflow_run 是否可见。"
    };
  }
  if (toolName === "start_workflow_run" || toolName === "inspect_workflow_run") {
    const value = result as WorkflowRunResult;
    return {
      kind: "workflow_run",
      id: value.workflowRun.id,
      status: value.workflowRun.status,
      handoffKind: value.workflowRun.handoffKind,
      reused: value.reused,
      nextStep: "重新读取 surface，并根据 workflow handoff 或 recovery 决定下一步。"
    };
  }
  if (toolName === "ask_human") {
    const value = result as { humanRequestId: string; status: string; questionArtifactPath: string };
    return {
      kind: "human_request",
      id: value.humanRequestId,
      status: value.status,
      artifactPath: value.questionArtifactPath,
      nextStep: "等待 human answer；等待期间不要继续执行副作用工具。"
    };
  }
  if (toolName === "create_pr") {
    const value = result as {
      pullRequest: { id: string; status: string; url?: string };
      reused: boolean;
    };
    return {
      kind: "pull_request",
      id: value.pullRequest.id,
      status: value.pullRequest.status,
      url: value.pullRequest.url,
      reused: value.reused,
      nextStep: "重新读取 surface，检查 PR/MR review 状态。"
    };
  }
  if (toolName === "update_pr") {
    const value = result as { pullRequest: { id: string; status: string; url?: string } };
    return {
      kind: "pull_request",
      id: value.pullRequest.id,
      status: value.pullRequest.status,
      url: value.pullRequest.url,
      nextStep: "重新读取 surface，继续 inspect_review 或请求人类确认。"
    };
  }
  if (toolName === "inspect_review") {
    const value = result as {
      pullRequest: { id: string; status: string; reviewStatus?: string; url?: string };
      review: { reviewStatus: string };
    };
    return {
      kind: "pull_request_review",
      id: value.pullRequest.id,
      status: value.review.reviewStatus,
      url: value.pullRequest.url,
      nextStep: "重新读取 surface；若 review clean 且 validation snapshot 有效，可请求 merge approval。"
    };
  }
  if (toolName === "request_merge_approval") {
    const value = result as { humanRequest: { id: string; status: string; questionArtifactPath?: string } };
    return {
      kind: "merge_approval_request",
      id: value.humanRequest.id,
      status: value.humanRequest.status,
      artifactPath: value.humanRequest.questionArtifactPath,
      nextStep: "等待 operator 显式 approve/reject；agent 不能自行批准 merge。"
    };
  }
  if (toolName === "merge_after_approval") {
    const value = result as { pullRequest: { id: string; status: string; url?: string } };
    return {
      kind: "pull_request_merge",
      id: value.pullRequest.id,
      status: value.pullRequest.status,
      url: value.pullRequest.url,
      nextStep: "重新读取 surface，确认 task 是否 completed。"
    };
  }
  return {
    kind: "unknown",
    nextStep: "重新读取 surface。"
  };
}

function previewText(content: string): string {
  const singleLine = content.replace(/\s+/g, " ").trim();
  return singleLine.length > 160 ? `${singleLine.slice(0, 157)}...` : singleLine;
}

function isPathInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
