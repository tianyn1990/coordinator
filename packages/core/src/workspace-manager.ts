import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, normalize, resolve, sep } from "node:path";
import {
  ActiveResourceConflictError,
  acquireLock,
  appendEvent,
  createArtifact,
  createOperation,
  createWorkspace,
  getActiveWorkspaceByAttempt,
  getAttempt,
  getProject,
  getWorkspace,
  releaseLock,
  assertLockHeld,
  updateWorkspace,
  updateOperation,
  withTransaction,
  type AttemptRecord,
  type DbContext,
  type LockRecord,
  type ProjectRecord,
  type WorkspaceRecord
} from "@coordinator/db";

export type WorkspaceGitRunner = (args: string[], options: { cwd: string }) => string;

export type CreateAttemptWorkspaceInput = {
  attemptId: string;
  owner?: string;
  worker?: LocalWorker;
  ttlMs?: number;
  now?: Date;
  gitRunner?: WorkspaceGitRunner;
};

export type LocalWorker = {
  id: string;
  kind: "local";
  host?: string;
  workspaceRoot?: string;
  capabilities?: string[];
};

export type WorkspaceManagerResult = {
  workspace: WorkspaceRecord;
  operationId: string;
  lockToken: string;
  ownershipManifestPath: string;
  checkpointArtifactPath: string;
  reused: boolean;
};

export type ResumeWorkspacePreflightInput = {
  workspaceId: string;
  gitRunner?: WorkspaceGitRunner;
};

export type PreflightStatus = "ok" | "blocked" | "retryable";

export type ResumeWorkspacePreflightResult = {
  status: PreflightStatus;
  checks: Array<{ name: string; status: PreflightStatus; summary: string }>;
  markdown: string;
};

export type WorkspaceRecoveryObservationKind =
  | "safe"
  | "record_missing"
  | "record_incomplete"
  | "missing"
  | "repo_missing"
  | "coordinator_missing"
  | "artifact_root_missing"
  | "path_escape"
  | "not_worktree"
  | "branch_mismatch"
  | "dirty_unknown"
  | "manifest_missing"
  | "manifest_mismatch"
  | "checkpoint_missing";

export type WorkspaceRecoveryObservation = {
  workspaceId?: string;
  projectId?: string;
  taskId?: string;
  attemptId?: string;
  kind: WorkspaceRecoveryObservationKind;
  safeToReleaseLock: boolean;
  observedSummary: string;
  artifactRefs: string[];
};

export type InspectWorkspaceRecoveryInput = {
  workspaceId: string;
  gitRunner?: WorkspaceGitRunner;
};

export class WorkspaceManagerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceManagerError";
  }
}

export class WorkspacePathError extends WorkspaceManagerError {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathError";
  }
}

export function createAttemptWorkspace(
  context: DbContext,
  input: CreateAttemptWorkspaceInput
): WorkspaceManagerResult {
  const worker = normalizeLocalWorker(input);
  const owner = worker.id;
  const attempt = requireAttemptRecord(context, input.attemptId);
  const project = requireProjectRecord(context, attempt.projectId);
  if (!project.repoPath) {
    throw new WorkspaceManagerError(`project ${project.id} 缺少 repoPath`);
  }
  if (!project.defaultBranch) {
    throw new WorkspaceManagerError(`project ${project.id} 缺少 defaultBranch，不能静默 fallback`);
  }

  const workspaceRoot = resolveWorkspaceRoot(project);
  const branch = buildWorkspaceBranch(attempt.taskId, attempt.id);
  const layout = buildWorkspaceLayout(workspaceRoot, project.id, attempt.taskId, attempt.id);
  const gitRunner = input.gitRunner ?? runGit;
  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? 5 * 60 * 1000;
  let attemptLock: LockRecord | undefined;
  let branchLock: LockRecord | undefined;
  let workspaceLock: LockRecord | undefined;
  let operationId: string | undefined;
  let sideEffectWindowStarted = false;
  let operationFailureAllowed = false;

  const existing = getActiveWorkspaceByAttempt(context, attempt.id);
  if (existing?.status === "ready") {
    return {
      workspace: existing,
      operationId: createOperation(context, {
        idempotencyKey: workspaceCreateKey(attempt.id),
        kind: "workspace:create",
        projectId: project.id,
        taskId: attempt.taskId,
        attemptId: attempt.id
      }).id,
      lockToken: "",
      ownershipManifestPath: join(existing.workspacePath ?? layout.workspacePath, "coordinator", "ownership.json"),
      checkpointArtifactPath: "checkpoint.md",
      reused: true
    };
  }

  try {
    const operation = createOperation(context, {
      idempotencyKey: workspaceCreateKey(attempt.id),
      kind: "workspace:create",
      projectId: project.id,
      taskId: attempt.taskId,
      attemptId: attempt.id
    });
    operationId = operation.id;
    assertOperationCanStart(operation.status);
    attemptLock = acquireLock(context, {
      resourceKind: "attempt",
      resourceId: attempt.id,
      owner,
      ttlMs,
      now
    });
    branchLock = acquireLock(context, {
      resourceKind: "project-branch",
      resourceId: `${project.id}:${branch}`,
      owner,
      ttlMs,
      now
    });
    updateOperation(context, {
      operationId: operation.id,
      status: "running",
      now,
      lastObservedState: { phase: "lock-acquired", branch }
    });
    operationFailureAllowed = true;

    if (existing && existing.status !== "creating" && existing.status !== "planned") {
      throw new ActiveResourceConflictError(`attempt ${attempt.id} 已存在 active workspace`);
    }

    const branchAlreadyExists = branchExists(project.repoPath, branch, gitRunner);
    const existingWorktreeUsable = isExistingWorktreeUsable(existing, layout.repoPath, branch, gitRunner);

    if (branchAlreadyExists && !existingWorktreeUsable) {
      throw new WorkspaceManagerError(`branch 已存在且未证明属于当前 attempt：${branch}`);
    }

    ensurePathPlanInsideRoot(workspaceRoot, layout.workspacePath);
    ensurePathPlanInsideRoot(layout.workspacePath, layout.repoPath);
    ensurePathPlanInsideRoot(layout.workspacePath, layout.coordinatorPath);
    ensurePathPlanInsideRoot(layout.coordinatorPath, layout.artifactRoot);
    inspectWorkspaceBeforeCreate(layout.workspacePath, existingWorktreeUsable);

    const workspace =
      existing ??
      createWorkspace(context, {
        projectId: project.id,
        taskId: attempt.taskId,
        attemptId: attempt.id,
        status: "creating",
        workspacePath: layout.workspacePath,
        repoPath: layout.repoPath,
        branch,
        baseBranch: project.defaultBranch
      });
    workspaceLock = acquireLock(context, {
      resourceKind: "workspace",
      resourceId: workspace.id,
      owner,
      ttlMs,
      now
    });
    sideEffectWindowStarted = true;

    mkdirSync(layout.coordinatorPath, { recursive: true });
    mkdirSync(layout.artifactRoot, { recursive: true });
    mkdirSync(layout.logsPath, { recursive: true });
    mkdirSync(layout.sessionsPath, { recursive: true });

    // git worktree 是本轮唯一真实外部副作用；执行前已持久化 operation 和 lock。
    if (!existingWorktreeUsable) {
      gitRunner(["worktree", "add", layout.repoPath, "-b", branch, project.defaultBranch], { cwd: project.repoPath });
    }

    ensureExistingPathInsideRoot(workspaceRoot, layout.workspacePath);
    ensureExistingPathInsideRoot(layout.workspacePath, layout.repoPath);
    ensureExistingPathInsideRoot(layout.coordinatorPath, layout.artifactRoot);

    const ownershipManifestPath = join(layout.coordinatorPath, "ownership.json");
    writeOwnershipManifest(ownershipManifestPath, {
      projectId: project.id,
      taskId: attempt.taskId,
      attemptId: attempt.id,
      workspaceId: workspace.id,
      branch,
      baseBranch: project.defaultBranch,
      owner,
      lockToken: workspaceLock.lockToken,
      createdAt: now.toISOString()
    });
    const checkpointArtifactPath = writeCheckpointArtifact(layout.artifactRoot, workspace, now);
    const activeWorkspaceLock = workspaceLock;

    const readyWorkspace = withTransaction(context, () => {
      const updated = updateWorkspace(context, {
        workspaceId: workspace.id,
        expectedStateVersion: workspace.stateVersion,
        status: "ready",
        workspacePath: layout.workspacePath,
        repoPath: layout.repoPath,
        branch,
        baseBranch: project.defaultBranch,
        lock: {
          resourceKind: "workspace",
          resourceId: workspace.id,
          lockToken: activeWorkspaceLock.lockToken,
          now
        }
      });
      createArtifact(context, {
        projectId: project.id,
        taskId: attempt.taskId,
        attemptId: attempt.id,
        kind: "checkpoint",
        owner: "workspace-manager",
        path: checkpointArtifactPath
      });
      appendEvent(context, {
        type: "workspace.ready",
        summary: `workspace ready: ${updated.id}`,
        projectId: project.id,
        taskId: attempt.taskId,
        attemptId: attempt.id,
        workspaceId: updated.id,
        operationId: operation.id,
        lockToken: activeWorkspaceLock.lockToken,
        artifactRefs: [checkpointArtifactPath],
        payload: {
          branch,
          baseBranch: project.defaultBranch,
          workspacePath: layout.workspacePath,
          repoPath: layout.repoPath,
          worker
        }
      });
      updateOperation(context, {
        operationId: operation.id,
        status: "succeeded",
        now,
        lastObservedState: {
          phase: "workspace-ready",
          workspaceId: updated.id,
          branch,
          repoPath: layout.repoPath
        }
      });
      return updated;
    });

    return {
      workspace: readyWorkspace,
      operationId: operation.id,
      lockToken: workspaceLock.lockToken,
      ownershipManifestPath,
      checkpointArtifactPath,
      reused: false
    };
  } catch (error) {
    if (operationId && (sideEffectWindowStarted || (operationFailureAllowed && !(error instanceof ActiveResourceConflictError)))) {
      updateOperation(context, {
        operationId,
        status: "failed",
        now,
        failureCode: error instanceof Error ? error.name : "unknown",
        lastObservedState: { phase: "workspace-create-failed", error: error instanceof Error ? error.message : String(error) }
      });
    }
    throw error;
  } finally {
    if (workspaceLock) {
      releaseLock(context, "workspace", workspaceLock.resourceId, workspaceLock.lockToken);
    }
    if (branchLock) {
      releaseLock(context, "project-branch", `${project.id}:${branch}`, branchLock.lockToken);
    }
    if (attemptLock) {
      releaseLock(context, "attempt", attempt.id, attemptLock.lockToken);
    }
  }
}

export function resumeWorkspacePreflight(
  context: DbContext,
  input: ResumeWorkspacePreflightInput
): ResumeWorkspacePreflightResult {
  const workspace = getWorkspace(context, input.workspaceId);
  if (!workspace) {
    return renderPreflight([{ name: "workspace-record", status: "retryable", summary: "workspace record 不存在。" }]);
  }
  const project = requireProjectRecord(context, workspace.projectId);
  const workspaceRoot = resolveWorkspaceRoot(project);
  const gitRunner = input.gitRunner ?? runGit;
  const checks: ResumeWorkspacePreflightResult["checks"] = [];

  const workspacePath = workspace.workspacePath;
  const repoPath = workspace.repoPath;
  if (!workspacePath || !repoPath || !workspace.branch || !workspace.baseBranch) {
    checks.push({ name: "workspace-record", status: "retryable", summary: "workspace record 缺少 path/branch 关键字段。" });
    return renderAndRecordPreflight(context, workspace, checks);
  }

  pushCheck(checks, "workspace-path", () => {
    assertExistingPathInsideRoot(workspaceRoot, workspacePath);
    return "workspace path 位于 workspace root 内。";
  });
  if (checks.some((check) => check.status !== "ok")) {
    return renderAndRecordPreflight(context, workspace, checks);
  }
  pushCheck(checks, "repo-path", () => {
    assertExistingPathInsideRoot(workspacePath, repoPath);
    return "repo path 位于 workspace 内。";
  });
  if (checks.some((check) => check.status !== "ok")) {
    return renderAndRecordPreflight(context, workspace, checks);
  }
  const coordinatorPath = join(workspacePath, "coordinator");
  pushCheck(checks, "coordinator-path", () => {
    assertExistingPathInsideRoot(workspacePath, coordinatorPath);
    return "coordinator path 位于 workspace 内。";
  });
  if (checks.some((check) => check.status !== "ok")) {
    return renderAndRecordPreflight(context, workspace, checks);
  }
  const artifactRoot = join(workspacePath, "coordinator", "artifacts");
  pushCheck(checks, "artifact-root", () => {
    assertExistingPathInsideRoot(coordinatorPath, artifactRoot);
    return "artifact root 位于 coordinator 目录内。";
  });
  if (checks.some((check) => check.status !== "ok")) {
    return renderAndRecordPreflight(context, workspace, checks);
  }
  pushCheck(checks, "git-worktree", () => {
    const inside = gitRunner(["rev-parse", "--is-inside-work-tree"], { cwd: repoPath }).trim();
    if (inside !== "true") {
      throw new WorkspaceManagerError("repo 不是 git worktree");
    }
    return "repo 是 git worktree。";
  });
  pushCheck(checks, "branch", () => {
    const currentBranch = gitRunner(["branch", "--show-current"], { cwd: repoPath }).trim();
    if (currentBranch !== workspace.branch) {
      throw new WorkspaceManagerError(`branch mismatch: ${currentBranch || "<empty>"} != ${workspace.branch}`);
    }
    return "当前 branch 与 workspace record 匹配。";
  });
  pushCheck(checks, "git-status", () => {
    const status = gitRunner(["status", "--porcelain"], { cwd: repoPath }).trim();
    if (hasNonWorkflowPrivateGitStatus(status)) {
      throw new WorkspaceManagerError("workspace dirty，需要 operator review 或 handoff");
    }
    return "git status clean。";
  });
  pushCheck(checks, "ownership-manifest", () => {
    const manifestPath = join(coordinatorPath, "ownership.json");
    assertExistingPathInsideRoot(coordinatorPath, manifestPath);
    const manifest = readOwnershipManifest(manifestPath);
    if (
      manifest.projectId !== workspace.projectId ||
      manifest.taskId !== workspace.taskId ||
      manifest.attemptId !== workspace.attemptId ||
      manifest.workspaceId !== workspace.id ||
      manifest.branch !== workspace.branch ||
      manifest.baseBranch !== workspace.baseBranch
    ) {
      throw new WorkspaceManagerError("ownership manifest 与 workspace record 不匹配");
    }
    return "ownership manifest 匹配 workspace record。";
  });
  pushCheck(checks, "checkpoint-artifact", () => {
    const checkpointPath = join(artifactRoot, "checkpoint.md");
    if (!existsSync(checkpointPath)) {
      throw new WorkspaceManagerError("checkpoint artifact 不存在");
    }
    ensureExistingPathInsideRoot(artifactRoot, checkpointPath);
    return "checkpoint artifact 存在。";
  });

  return renderAndRecordPreflight(context, workspace, checks);
}

export function inspectWorkspaceRecovery(
  context: DbContext,
  input: InspectWorkspaceRecoveryInput
): WorkspaceRecoveryObservation {
  const workspace = getWorkspace(context, input.workspaceId);
  if (!workspace) {
    return {
      workspaceId: input.workspaceId,
      kind: "record_missing",
      safeToReleaseLock: false,
      observedSummary: "workspace record missing",
      artifactRefs: []
    };
  }
  const project = requireProjectRecord(context, workspace.projectId);
  const workspaceRoot = resolveWorkspaceRoot(project);
  const gitRunner = input.gitRunner ?? runGit;
  const refs: string[] = [];

  const base = {
    workspaceId: workspace.id,
    projectId: workspace.projectId,
    taskId: workspace.taskId,
    attemptId: workspace.attemptId,
    artifactRefs: refs
  };
  const fail = (kind: WorkspaceRecoveryObservationKind, observedSummary: string): WorkspaceRecoveryObservation => ({
    ...base,
    kind,
    safeToReleaseLock: false,
    observedSummary
  });

  const workspacePath = workspace.workspacePath;
  const repoPath = workspace.repoPath;
  if (!workspacePath || !repoPath || !workspace.branch || !workspace.baseBranch) {
    return fail("record_incomplete", "workspace record missing path or branch fields");
  }

  const workspacePathCheck = classifyPath(workspaceRoot, workspacePath, "workspace path");
  if (workspacePathCheck) {
    return fail(workspacePathCheck.kind, workspacePathCheck.summary);
  }
  const repoPathCheck = classifyPath(workspacePath, repoPath, "repo path");
  if (repoPathCheck) {
    return fail(repoPathCheck.kind === "missing" ? "repo_missing" : repoPathCheck.kind, repoPathCheck.summary);
  }
  const coordinatorPath = join(workspacePath, "coordinator");
  const coordinatorPathCheck = classifyPath(workspacePath, coordinatorPath, "coordinator path");
  if (coordinatorPathCheck) {
    return fail(coordinatorPathCheck.kind === "missing" ? "coordinator_missing" : coordinatorPathCheck.kind, coordinatorPathCheck.summary);
  }
  const artifactRoot = join(coordinatorPath, "artifacts");
  const artifactRootCheck = classifyPath(coordinatorPath, artifactRoot, "artifact root");
  if (artifactRootCheck) {
    return fail(artifactRootCheck.kind === "missing" ? "artifact_root_missing" : artifactRootCheck.kind, artifactRootCheck.summary);
  }

  const worktreeCheck = classifyGit(() => gitRunner(["rev-parse", "--is-inside-work-tree"], { cwd: repoPath }).trim());
  if (worktreeCheck !== "true") {
    return fail("not_worktree", "repo is not a git worktree");
  }
  const currentBranch = classifyGit(() => gitRunner(["branch", "--show-current"], { cwd: repoPath }).trim());
  if (currentBranch !== workspace.branch) {
    return fail("branch_mismatch", "workspace branch mismatch");
  }
  const status = classifyGit(() => gitRunner(["status", "--porcelain"], { cwd: repoPath }).trim());
  if (hasNonWorkflowPrivateGitStatus(status)) {
    return fail("dirty_unknown", "workspace dirty with unknown source");
  }

  const manifestPath = join(coordinatorPath, "ownership.json");
  const manifestPathCheck = classifyPath(coordinatorPath, manifestPath, "ownership manifest");
  if (manifestPathCheck) {
    return fail(manifestPathCheck.kind === "missing" ? "manifest_missing" : manifestPathCheck.kind, manifestPathCheck.summary);
  }
  const manifest = readOwnershipManifestSafely(manifestPath);
  if (!manifest) {
    return fail("manifest_mismatch", "ownership manifest is malformed");
  }
  if (
    manifest.projectId !== workspace.projectId ||
    manifest.taskId !== workspace.taskId ||
    manifest.attemptId !== workspace.attemptId ||
    manifest.workspaceId !== workspace.id ||
    manifest.branch !== workspace.branch ||
    manifest.baseBranch !== workspace.baseBranch
  ) {
    return fail("manifest_mismatch", "ownership manifest does not match workspace record");
  }

  const checkpointPath = join(artifactRoot, "checkpoint.md");
  const checkpointPathCheck = classifyPath(artifactRoot, checkpointPath, "checkpoint artifact");
  if (checkpointPathCheck) {
    return fail(checkpointPathCheck.kind === "missing" ? "checkpoint_missing" : checkpointPathCheck.kind, checkpointPathCheck.summary);
  }
  refs.push("checkpoint.md");

  return {
    ...base,
    kind: "safe",
    safeToReleaseLock: true,
    observedSummary: "workspace recovery observation safe"
  };
}

export function assertWorkspaceLockHeldForUpdate(
  context: DbContext,
  workspaceId: string,
  lockToken: string,
  now = new Date()
): void {
  assertLockHeld(context, "workspace", workspaceId, lockToken, now);
}

export function buildWorkspaceBranch(taskId: string, attemptId: string): string {
  return `coordinator/${sanitizeBranchPart(taskId)}/${sanitizeBranchPart(attemptId)}`;
}

export function assertArtifactRelativePath(relativePath: string): string {
  const value = requireNonEmpty(relativePath, "relativePath");
  if (value.startsWith("/") || value.includes("\0")) {
    throw new WorkspacePathError("artifact path 必须是相对路径");
  }
  const normalized = normalize(value);
  if (normalized === ".." || normalized.startsWith(`..${sep}`) || normalized.includes(`${sep}..${sep}`)) {
    throw new WorkspacePathError("artifact path 不允许包含 ..");
  }
  return normalized;
}

function renderAndRecordPreflight(
  context: DbContext,
  workspace: WorkspaceRecord,
  checks: ResumeWorkspacePreflightResult["checks"]
): ResumeWorkspacePreflightResult {
  const result = renderPreflight(checks);
  appendEvent(context, {
    type: "workspace.preflight",
    summary: `workspace preflight: ${result.status}`,
    projectId: workspace.projectId,
    taskId: workspace.taskId,
    attemptId: workspace.attemptId,
    workspaceId: workspace.id,
    severity: result.status === "ok" ? "info" : "warn",
    payload: { status: result.status, checks }
  });
  return result;
}

function renderPreflight(checks: ResumeWorkspacePreflightResult["checks"]): ResumeWorkspacePreflightResult {
  const status = checks.some((check) => check.status === "blocked")
    ? "blocked"
    : checks.some((check) => check.status === "retryable")
      ? "retryable"
      : "ok";
  const markdown = [
    "# Workspace Resume Preflight",
    "",
    `状态：${status}`,
    "",
    ...checks.map((check) => `- ${check.name}: ${check.status} - ${check.summary}`)
  ].join("\n");
  return { status, checks, markdown };
}

function pushCheck(
  checks: ResumeWorkspacePreflightResult["checks"],
  name: string,
  fn: () => string
): void {
  try {
    checks.push({ name, status: "ok", summary: fn() });
  } catch (error) {
    checks.push({
      name,
      status: error instanceof WorkspacePathError ? "blocked" : "blocked",
      summary: error instanceof Error ? error.message : String(error)
    });
  }
}

function resolveWorkspaceRoot(project: ProjectRecord): string {
  return resolve(project.workspaceRoot ?? join(homedir(), ".coordinator", "workspaces"));
}

function buildWorkspaceLayout(workspaceRoot: string, projectId: string, taskId: string, attemptId: string) {
  const workspacePath = resolve(
    workspaceRoot,
    sanitizePathPart(projectId),
    sanitizePathPart(taskId),
    sanitizePathPart(attemptId)
  );
  return {
    workspacePath,
    repoPath: join(workspacePath, "repo"),
    coordinatorPath: join(workspacePath, "coordinator"),
    artifactRoot: join(workspacePath, "coordinator", "artifacts"),
    logsPath: join(workspacePath, "coordinator", "logs"),
    sessionsPath: join(workspacePath, "coordinator", "sessions")
  };
}

function branchExists(repoPath: string, branch: string, gitRunner: WorkspaceGitRunner): boolean {
  try {
    gitRunner(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: repoPath }).trim();
    return true;
  } catch (error) {
    if (error instanceof WorkspaceManagerError) {
      throw error;
    }
    return false;
  }
}

function isExistingWorktreeUsable(
  workspace: WorkspaceRecord | undefined,
  repoPath: string,
  branch: string,
  gitRunner: WorkspaceGitRunner
): boolean {
  if (!workspace || workspace.repoPath !== repoPath || workspace.branch !== branch || !existsSync(repoPath)) {
    return false;
  }
  try {
    const inside = gitRunner(["rev-parse", "--is-inside-work-tree"], { cwd: repoPath }).trim();
    const currentBranch = gitRunner(["branch", "--show-current"], { cwd: repoPath }).trim();
    return inside === "true" && currentBranch === branch;
  } catch {
    return false;
  }
}

function assertOperationCanStart(status: string): void {
  if (status === "succeeded" || status === "reconciled" || status === "canceled") {
    throw new WorkspaceManagerError(`operation is terminal: ${status}`);
  }
}

function inspectWorkspaceBeforeCreate(workspacePath: string, allowExistingRepo: boolean): void {
  if (!existsSync(workspacePath)) {
    return;
  }
  const entriesAreExpected =
    readdirSync(workspacePath).length === 0 ||
    (existsSync(join(workspacePath, "coordinator")) &&
      (allowExistingRepo ? existsSync(join(workspacePath, "repo")) : !existsSync(join(workspacePath, "repo"))));
  if (!entriesAreExpected) {
    throw new WorkspaceManagerError(`workspace path 已存在且不能安全复用：${workspacePath}`);
  }
}

function ensurePathPlanInsideRoot(rootPath: string, targetPath: string): void {
  const rootReal = ensureExistingDirectoryRealpath(rootPath);
  const plannedReal = plannedTargetRealpath(resolve(targetPath));
  if (!isPathInside(rootReal, plannedReal)) {
    throw new WorkspacePathError(`path 不在允许 root 内：${targetPath}`);
  }
}

function ensureExistingPathInsideRoot(rootPath: string, targetPath: string): void {
  const rootReal = ensureExistingDirectoryRealpath(rootPath);
  assertExistingPathInsideResolvedRoot(rootReal, targetPath);
}

function assertExistingPathInsideRoot(rootPath: string, targetPath: string): void {
  if (!existsSync(rootPath)) {
    throw new WorkspacePathError(`root path 不存在：${rootPath}`);
  }
  const rootReal = realpathSync(rootPath);
  assertExistingPathInsideResolvedRoot(rootReal, targetPath);
}

function assertExistingPathInsideResolvedRoot(rootReal: string, targetPath: string): void {
  if (!existsSync(targetPath)) {
    throw new WorkspacePathError(`path 不存在：${targetPath}`);
  }
  const targetReal = realpathSync(targetPath);
  if (!isPathInside(rootReal, targetReal)) {
    throw new WorkspacePathError(`path realpath 不在允许 root 内：${targetPath}`);
  }
}

function classifyPath(
  rootPath: string,
  targetPath: string,
  label: string
): { kind: "missing" | "path_escape"; summary: string } | undefined {
  try {
    assertExistingPathInsideRoot(rootPath, targetPath);
    return undefined;
  } catch (error) {
    const summary = error instanceof Error ? error.message : String(error);
    return { kind: summary.includes("不存在") ? "missing" : "path_escape", summary: `${label}: ${summary}` };
  }
}

function classifyGit(fn: () => string): string {
  try {
    return fn();
  } catch {
    return "";
  }
}

function ensureExistingDirectoryRealpath(path: string): string {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
  if (!statSync(path).isDirectory()) {
    throw new WorkspacePathError(`path 不是目录：${path}`);
  }
  return realpathSync(path);
}

function plannedTargetRealpath(targetPath: string): string {
  let current = targetPath;
  const missingSegments: string[] = [];
  while (!existsSync(current)) {
    missingSegments.unshift(basename(current));
    const parent = dirname(current);
    if (parent === current) {
      throw new WorkspacePathError(`找不到已存在 parent：${targetPath}`);
    }
    current = parent;
  }
  return resolve(realpathSync(current), ...missingSegments);
}

function isPathInside(rootReal: string, targetReal: string): boolean {
  const root = rootReal.endsWith(sep) ? rootReal : `${rootReal}${sep}`;
  return targetReal === rootReal || targetReal.startsWith(root);
}

function sanitizePathPart(value: string): string {
  return sanitizeBranchPart(value);
}

function sanitizeBranchPart(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return sanitized.length > 0 ? sanitized : "empty";
}

function normalizeLocalWorker(input: CreateAttemptWorkspaceInput): LocalWorker {
  if (input.worker) {
    return {
      ...input.worker,
      id: requireNonEmpty(input.worker.id, "worker.id"),
      kind: "local",
      capabilities: input.worker.capabilities ?? ["git-worktree", "local-filesystem"]
    };
  }
  return {
    id: requireNonEmpty(input.owner ?? "local-worker", "owner"),
    kind: "local",
    capabilities: ["git-worktree", "local-filesystem"]
  };
}

function writeOwnershipManifest(path: string, manifest: OwnershipManifest): void {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function readOwnershipManifest(path: string): OwnershipManifest {
  return JSON.parse(readFileSync(path, "utf8")) as OwnershipManifest;
}

function readOwnershipManifestSafely(path: string): OwnershipManifest | undefined {
  try {
    return readOwnershipManifest(path);
  } catch {
    return undefined;
  }
}

function writeCheckpointArtifact(artifactRoot: string, workspace: WorkspaceRecord, now: Date): string {
  const relativePath = assertArtifactRelativePath("checkpoint.md");
  const fullPath = join(artifactRoot, relativePath);
  writeFileSync(
    fullPath,
    [
      "# Workspace Checkpoint",
      "",
      `workspace_id: ${workspace.id}`,
      `attempt_id: ${workspace.attemptId}`,
      `branch: ${workspace.branch ?? ""}`,
      `base_branch: ${workspace.baseBranch ?? ""}`,
      `created_at: ${now.toISOString()}`,
      ""
    ].join("\n"),
    "utf8"
  );
  return relativePath;
}

function workspaceCreateKey(attemptId: string): string {
  return `workspace:create:${attemptId}`;
}

function requireAttemptRecord(context: DbContext, attemptId: string): AttemptRecord {
  const attempt = getAttempt(context, attemptId);
  if (!attempt) {
    throw new WorkspaceManagerError(`attempt not found: ${attemptId}`);
  }
  return attempt;
}

function requireProjectRecord(context: DbContext, projectId: string): ProjectRecord {
  const project = getProject(context, projectId);
  if (!project) {
    throw new WorkspaceManagerError(`project not found: ${projectId}`);
  }
  return project;
}

function requireNonEmpty(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new WorkspaceManagerError(`${fieldName} 不能为空`);
  }
  return normalized;
}

function runGit(args: string[], options: { cwd: string }): string {
  return execFileSync("git", args, { cwd: options.cwd, encoding: "utf8" });
}

function hasNonWorkflowPrivateGitStatus(status: string): boolean {
  // `.workflow/` 是 workflow runtime 的私有状态目录；Coordinator 只忽略路径本身，不读取其中内容。
  return status
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .some((line) => !isWorkflowPrivateStatusLine(line));
}

function isWorkflowPrivateStatusLine(line: string): boolean {
  const path = line.length > 3 ? line.slice(3).trim() : line.trim();
  const normalizedPath = path.includes(" -> ") ? path.split(" -> ").pop()?.trim() ?? path : path;
  return normalizedPath === ".workflow" || normalizedPath.startsWith(".workflow/");
}

type OwnershipManifest = {
  projectId: string;
  taskId: string;
  attemptId: string;
  workspaceId: string;
  branch: string;
  baseBranch: string;
  owner: string;
  lockToken: string;
  createdAt: string;
};

// 测试会构造失败后残留目录，提供一个窄 cleanup helper 避免测试污染真实 workspace。
export function removeWorkspaceForTest(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
