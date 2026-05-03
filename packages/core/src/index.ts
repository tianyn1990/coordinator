import { existsSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createProject, getProject, listProjects, type DbContext, type ProjectRecord } from "@coordinator/db";
export {
  CoordinatorAgentToolError,
  executeCoordinatorAgentTool
} from "./coordinator-agent-tools.js";
export {
  AgentProviderRuntimeError,
  ClaudeCodeProvider,
  CodexProvider,
  FakeAgentProvider,
  ProviderUnavailableError,
  createAgentProvider,
  inspectAgentSession,
  runCoordinatorAgentSession
} from "./agent-provider-runtime.js";
export { DaemonRuntimeError, parseAgentToolRequest, runDaemonTick } from "./daemon-runtime.js";
export {
  OperatorSurfaceError,
  createManualTask,
  getOperatorTaskDetail,
  listOperatorTasks,
  recordHumanAnswerRuntime
} from "./operator-surface.js";
export { buildCoordinatorSurface, buildTaskSurfaceFromDb, renderSurfaceMarkdown } from "./surface.js";
export {
  WorkspaceManagerError,
  WorkspacePathError,
  assertArtifactRelativePath,
  buildWorkspaceBranch,
  createAttemptWorkspace,
  removeWorkspaceForTest,
  resumeWorkspacePreflight
} from "./workspace-manager.js";
export {
  WorkflowProtocolError,
  inspectWorkflowCapabilities,
  inspectWorkflowRun,
  invokeWorkflowAction,
  listWorkflowArtifacts,
  listWorkflowEvents,
  startWorkflowRun
} from "./workflow-protocol-adapter.js";
export {
  CliPullRequestProvider,
  FakePullRequestProvider,
  PullRequestProviderError,
  approveMergeRuntime,
  createPullRequestProvider,
  createPullRequestRuntime,
  inspectPullRequestReviewRuntime,
  mergeAfterApprovalRuntime,
  rejectMergeRuntime,
  requestMergeApprovalRuntime,
  updatePullRequestRuntime
} from "./pr-mr-provider.js";
export type {
  CoordinatorAgentToolArgs,
  CoordinatorAgentToolFailureCode,
  CoordinatorAgentToolName,
  CoordinatorAgentToolResult,
  ExecuteCoordinatorAgentToolInput
} from "./coordinator-agent-tools.js";
export type {
  AgentProvider,
  AgentProviderRunInput,
  AgentProviderRunResult,
  AgentProviderRunner,
  AgentSessionInspection,
  AgentSessionRuntimeResult,
  InspectAgentSessionInput,
  RunCoordinatorAgentSessionInput
} from "./agent-provider-runtime.js";
export type { DaemonActionResult, DaemonRuntimeInput, DaemonTickResult, ParsedAgentToolRequest } from "./daemon-runtime.js";
export type {
  CreateManualTaskInput,
  OperatorTaskDetail,
  OperatorTaskListItem,
  RecordHumanAnswerInput,
  RecordHumanAnswerResult
} from "./operator-surface.js";
export type {
  CreateAttemptWorkspaceInput,
  PreflightStatus,
  ResumeWorkspacePreflightInput,
  ResumeWorkspacePreflightResult,
  WorkspaceGitRunner,
  WorkspaceManagerResult
} from "./workspace-manager.js";
export type {
  InspectWorkflowCapabilitiesInput,
  InspectWorkflowRunInput,
  InvokeWorkflowActionInput,
  ListWorkflowArtifactsInput,
  ListWorkflowEventsInput,
  StartWorkflowRunInput,
  WorkflowArtifacts,
  WorkflowCapabilities,
  WorkflowEvents,
  WorkflowHandoff,
  WorkflowHandoffKind,
  WorkflowLifecycle,
  WorkflowProfileCapability,
  WorkflowProtocolRunner,
  WorkflowRunResult,
  WorkflowStatus
} from "./workflow-protocol-adapter.js";
export type {
  ApproveMergeRuntimeInput,
  CreatePullRequestRuntimeInput,
  InspectPullRequestReviewRuntimeInput,
  MergeAfterApprovalRuntimeInput,
  PullRequestProvider,
  PullRequestProviderCreateInput,
  PullRequestProviderCreateResult,
  PullRequestProviderInspectExistingInput,
  PullRequestProviderInspectExistingResult,
  PullRequestProviderKind,
  PullRequestProviderMergeInput,
  PullRequestProviderMergeResult,
  PullRequestProviderReviewInput,
  PullRequestProviderReviewResult,
  PullRequestProviderRunner,
  PullRequestProviderUpdateInput,
  PullRequestProviderUpdateResult,
  RequestMergeApprovalRuntimeInput,
  UpdatePullRequestRuntimeInput
} from "./pr-mr-provider.js";
export type {
  AgentSessionSnapshot,
  AutonomyGuidanceSnapshot,
  CoordinatorSurfaceJson,
  CurrentStateSnapshot,
  EntitySnapshot,
  ExecutionPlanSnapshot,
  HumanRequestSnapshot,
  MemoryTrustBoundarySnapshot,
  MergeApprovalSnapshot,
  NoPrCompletionSnapshot,
  PullRequestSnapshot,
  ProjectSnapshot,
  SurfaceEnvelope,
  SurfaceKind,
  SurfaceSnapshot,
  SurfaceToolJson,
  TaskSnapshot,
  ValidationContractSnapshot,
  WorkflowRunSnapshot,
  WorkspaceSnapshot
} from "./surface.js";

export type GitProviderKind = "github" | "gitlab";

export type GitRunner = (args: string[], options: { cwd: string }) => string;

export type RegisterProjectInput = {
  repoPath: string;
  name?: string;
  providerOverride?: string;
  confirmedDefaultBranch?: string;
  workflowLauncher?: string;
  outerAgentDefaultProvider?: string;
  innerAgentDefaultProvider?: string;
  workspaceRoot?: string;
  gitLabHosts?: string[];
  gitRunner?: GitRunner;
};

export type ProjectRegistrationResult = {
  project?: ProjectRecord;
  blocked: boolean;
  blockers: string[];
  detected: {
    repoUrl?: string;
    gitProviderKind?: GitProviderKind;
    gitProviderHost?: string;
    remoteHeadBranch?: string;
  };
};

export function registerProject(context: DbContext, input: RegisterProjectInput): ProjectRegistrationResult {
  const repoPath = resolve(requireNonEmpty(input.repoPath, "repoPath"));
  const gitRunner = input.gitRunner ?? runGit;
  const providerOverride = normalizeProviderOverride(input.providerOverride);
  const confirmedDefaultBranch = normalizeOptionalNonEmpty(input.confirmedDefaultBranch, "confirmedDefaultBranch");
  const workflowLauncher = normalizeOptionalNonEmpty(input.workflowLauncher, "workflowLauncher");
  const outerAgentDefaultProvider = normalizeOptionalNonEmpty(input.outerAgentDefaultProvider, "outerAgentDefaultProvider");
  const innerAgentDefaultProvider = normalizeOptionalNonEmpty(input.innerAgentDefaultProvider, "innerAgentDefaultProvider");
  const workspaceRoot = normalizeOptionalNonEmpty(input.workspaceRoot, "workspaceRoot");

  assertDirectory(repoPath);
  assertGitRepository(repoPath, gitRunner);

  const repoUrl = readGitValue(gitRunner, repoPath, ["config", "--get", "remote.origin.url"]);
  const provider = providerOverride ? detectProviderFromOverride(providerOverride, repoUrl) : detectGitProvider(repoUrl, input.gitLabHosts);
  const remoteHeadBranch = detectRemoteHeadBranch(gitRunner, repoPath);
  const defaultBranch = confirmedDefaultBranch;
  const blockers: string[] = [];
  const missingCapabilities: string[] = [];
  const configuredCapabilities = {
    workflowLauncher: Boolean(workflowLauncher),
    outerAgentDefaultProvider: Boolean(outerAgentDefaultProvider),
    innerAgentDefaultProvider: Boolean(innerAgentDefaultProvider),
    prProviderKind: Boolean(provider.kind)
  };

  if (!provider.kind) {
    blockers.push("git-provider-required");
  }
  if (!defaultBranch) {
    blockers.push("default-branch-confirmation-required");
  }
  if (!workflowLauncher) {
    missingCapabilities.push("workflow-launcher");
  }
  if (!outerAgentDefaultProvider) {
    missingCapabilities.push("outer-agent-default-provider");
  }
  if (!innerAgentDefaultProvider) {
    missingCapabilities.push("inner-agent-default-provider");
  }

  if (blockers.length > 0) {
    return {
      blocked: true,
      blockers,
      detected: {
        repoUrl,
        gitProviderKind: provider.kind,
        gitProviderHost: provider.host,
        remoteHeadBranch
      }
    };
  }

  const project = createProject(context, {
    name: input.name ?? basename(repoPath),
    repoPath,
    repoUrl,
    gitProviderKind: provider.kind,
    gitProviderHost: provider.host,
    defaultBranch,
    prProviderKind: provider.kind,
    workspaceRoot,
    workflowLauncher,
    outerAgentDefaultProvider,
    innerAgentDefaultProvider,
    registrationStatus: missingCapabilities.length > 0 ? "degraded" : "registered",
    registryNotes: {
      remoteHeadBranch,
      configuredCapabilities,
      missingCapabilities
    }
  });

  return {
    project,
    blocked: false,
    blockers: [],
    detected: {
      repoUrl,
      gitProviderKind: provider.kind,
      gitProviderHost: provider.host,
      remoteHeadBranch
    }
  };
}

export function viewProjectRegistry(context: DbContext, projectId?: string): ProjectRecord[] {
  if (projectId) {
    const project = getProject(context, projectId);
    return project ? [project] : [];
  }
  return listProjects(context);
}

export function detectGitProvider(repoUrl: string | undefined, gitLabHosts: string[] = []): { kind?: GitProviderKind; host?: string } {
  if (!repoUrl) {
    return {};
  }
  const host = extractHost(repoUrl);
  if (host === "github.com") {
    return { kind: "github", host };
  }
  if (host && (host === "gitlab.com" || gitLabHosts.includes(host))) {
    return { kind: "gitlab", host };
  }
  return host ? { host } : {};
}

function detectProviderFromOverride(kind: GitProviderKind, repoUrl: string | undefined): { kind: GitProviderKind; host?: string } {
  return { kind, host: extractHost(repoUrl) };
}

function normalizeProviderOverride(providerOverride: string | undefined): GitProviderKind | undefined {
  if (providerOverride === undefined) {
    return undefined;
  }
  const normalized = providerOverride.trim();
  if (normalized.length === 0) {
    throw new ProjectRegistryInputError("providerOverride 不能为空");
  }
  if (normalized === "github" || normalized === "gitlab") {
    return normalized;
  }
  throw new ProjectRegistryInputError(`不支持的 providerOverride：${providerOverride}`);
}

function normalizeOptionalNonEmpty(value: string | undefined, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new ProjectRegistryInputError(`${fieldName} 不能为空`);
  }
  return normalized;
}

function requireNonEmpty(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new ProjectRegistryInputError(`${fieldName} 不能为空`);
  }
  return normalized;
}

function assertDirectory(path: string): void {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`repo path 不是目录：${path}`);
  }
}

function assertGitRepository(repoPath: string, gitRunner: GitRunner): void {
  const isInside = readGitValue(gitRunner, repoPath, ["rev-parse", "--is-inside-work-tree"]);
  if (isInside !== "true") {
    throw new Error(`repo path 不是 git repository：${repoPath}`);
  }
}

function detectRemoteHeadBranch(gitRunner: GitRunner, repoPath: string): string | undefined {
  const ref = readGitValue(gitRunner, repoPath, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  return ref?.replace(/^origin\//, "");
}

function readGitValue(gitRunner: GitRunner, cwd: string, args: string[]): string | undefined {
  try {
    const output = gitRunner(args, { cwd }).trim();
    return output.length > 0 ? output : undefined;
  } catch {
    return undefined;
  }
}

function runGit(args: string[], options: { cwd: string }): string {
  return execFileSync("git", args, { cwd: options.cwd, encoding: "utf8" });
}

function extractHost(repoUrl: string | undefined): string | undefined {
  if (!repoUrl) {
    return undefined;
  }
  try {
    return new URL(repoUrl).host;
  } catch {
    const sshMatch = repoUrl.match(/^[^@]+@([^:]+):/);
    return sshMatch?.[1];
  }
}

export class ProjectRegistryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectRegistryInputError";
  }
}
