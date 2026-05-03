import { existsSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ActiveResourceConflictError,
  acquireLock,
  createWorkspace,
  createAttempt,
  getOperationByIdempotencyKey,
  createProject,
  createTask,
  runMigrations,
  updateOperation,
  withDatabase
} from "@coordinator/db";
import {
  WorkspaceManagerError,
  WorkspacePathError,
  assertArtifactRelativePath,
  buildWorkspaceBranch,
  createAttemptWorkspace,
  resumeWorkspacePreflight,
  type WorkspaceGitRunner
} from "./index.js";

function createMigratedDatabase(): string {
  const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-workspace-db-")), "workspace.sqlite");
  runMigrations(databasePath);
  return databasePath;
}

function createRepoFixture(): string {
  const repoPath = mkdtempSync(join(tmpdir(), "coordinator-repo-"));
  mkdirSync(join(repoPath, ".git"));
  writeFileSync(join(repoPath, ".git", "HEAD"), "ref: refs/heads/main\n");
  return repoPath;
}

function createFakeGitRunner(options: { existingBranch?: string; dirty?: boolean; currentBranch?: string } = {}) {
  const calls: string[][] = [];
  const runner: WorkspaceGitRunner = (args) => {
    calls.push(args);
    if (args[0] === "rev-parse" && args[1] === "--verify") {
      if (options.existingBranch) {
        return `${options.existingBranch}\n`;
      }
      throw new Error("branch not found");
    }
    if (args[0] === "worktree" && args[1] === "add") {
      const repoPath = args[2];
      mkdirSync(repoPath, { recursive: true });
      mkdirSync(join(repoPath, ".git"));
      return "";
    }
    if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
      return "true\n";
    }
    if (args[0] === "branch" && args[1] === "--show-current") {
      return `${options.currentBranch ?? "coordinator/task-1/attempt-1"}\n`;
    }
    if (args[0] === "status" && args[1] === "--porcelain") {
      return options.dirty ? " M file.ts\n" : "";
    }
    return "";
  };
  return { runner, calls };
}

describe("workspace manager", () => {
  it("生成确定性且安全的 branch 名", () => {
    expect(buildWorkspaceBranch("task 1/unsafe", "attempt:1")).toBe("coordinator/task-1-unsafe/attempt-1");
    expect(buildWorkspaceBranch("task 1/unsafe", "attempt:1")).toBe("coordinator/task-1-unsafe/attempt-1");
    expect(buildWorkspaceBranch("   ", "///")).toBe("coordinator/empty/empty");
  });

  it("artifact 相对路径拒绝绝对路径和 ..", () => {
    expect(assertArtifactRelativePath("reports/checkpoint.md")).toBe("reports/checkpoint.md");
    expect(() => assertArtifactRelativePath("/tmp/checkpoint.md")).toThrow(WorkspacePathError);
    expect(() => assertArtifactRelativePath("../checkpoint.md")).toThrow(WorkspacePathError);
  });

  it("基于 project defaultBranch 创建 worktree workspace 并写 checkpoint", () => {
    const databasePath = createMigratedDatabase();
    const repoPath = createRepoFixture();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-workspaces-"));
    const git = createFakeGitRunner({ currentBranch: "coordinator/task-1/attempt-1" });

    const result = withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-1",
        name: "coordinator",
        repoPath,
        defaultBranch: "main",
        workspaceRoot
      });
      const task = createTask(context, { id: "task-1", projectId: project.id, title: "workspace" });
      const attempt = createAttempt(context, { id: "attempt-1", projectId: project.id, taskId: task.id });
      return createAttemptWorkspace(context, { attemptId: attempt.id, owner: "worker-1", gitRunner: git.runner });
    });

    expect(result.workspace).toMatchObject({
      status: "ready",
      branch: "coordinator/task-1/attempt-1",
      baseBranch: "main"
    });
    expect(result.reused).toBe(false);
    expect(result.checkpointArtifactPath).toBe("checkpoint.md");
    expect(git.calls).toContainEqual(["worktree", "add", result.workspace.repoPath, "-b", "coordinator/task-1/attempt-1", "main"]);
  });

  it("workspace 创建成功后 operation 记录 succeeded 和 observed state", () => {
    const databasePath = createMigratedDatabase();
    const repoPath = createRepoFixture();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-workspaces-"));

    const result = withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-op",
        name: "coordinator",
        repoPath,
        defaultBranch: "main",
        workspaceRoot
      });
      const task = createTask(context, { id: "task-op", projectId: project.id, title: "workspace" });
      const attempt = createAttempt(context, { id: "attempt-op", projectId: project.id, taskId: task.id });
      const created = createAttemptWorkspace(context, {
        attemptId: attempt.id,
        worker: { id: "local-worker-1", kind: "local", workspaceRoot },
        gitRunner: createFakeGitRunner({ currentBranch: "coordinator/task-op/attempt-op" }).runner
      });
      const reusedOperation = updateOperation(context, {
        operationId: created.operationId,
        status: "succeeded",
        lastObservedState: { phase: "verified" }
      });
      return { created, reusedOperation };
    });

    expect(result.created.lockToken).toBeTruthy();
    expect(result.reusedOperation).toMatchObject({
      status: "succeeded",
      lastObservedState: { phase: "verified" }
    });
  });

  it("同一 attempt 已有 ready workspace 时复用且不重复执行 git worktree", () => {
    const databasePath = createMigratedDatabase();
    const repoPath = createRepoFixture();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-workspaces-"));
    const git = createFakeGitRunner({ currentBranch: "coordinator/task-1/attempt-1" });

    const result = withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-1",
        name: "coordinator",
        repoPath,
        defaultBranch: "main",
        workspaceRoot
      });
      const task = createTask(context, { id: "task-1", projectId: project.id, title: "workspace" });
      const attempt = createAttempt(context, { id: "attempt-1", projectId: project.id, taskId: task.id });
      const first = createAttemptWorkspace(context, { attemptId: attempt.id, owner: "worker-1", gitRunner: git.runner });
      const callCount = git.calls.length;
      const second = createAttemptWorkspace(context, { attemptId: attempt.id, owner: "worker-2", gitRunner: git.runner });
      return { first, second, callCount, finalCallCount: git.calls.length };
    });

    expect(result.second.workspace.id).toBe(result.first.workspace.id);
    expect(result.second.reused).toBe(true);
    expect(result.finalCallCount).toBe(result.callCount);
  });

  it("缺少 project defaultBranch 时拒绝创建 workspace", () => {
    const databasePath = createMigratedDatabase();
    const repoPath = createRepoFixture();

    expect(() =>
      withDatabase(databasePath, (context) => {
        const project = createProject(context, {
          id: "project-missing-base",
          name: "coordinator",
          repoPath
        });
        const task = createTask(context, { id: "task-missing-base", projectId: project.id, title: "workspace" });
        const attempt = createAttempt(context, { id: "attempt-missing-base", projectId: project.id, taskId: task.id });
        createAttemptWorkspace(context, { attemptId: attempt.id, owner: "worker-1", gitRunner: createFakeGitRunner().runner });
      })
    ).toThrow(/defaultBranch/);
  });

  it("branch 已存在但不属于当前 attempt 时拒绝创建", () => {
    const databasePath = createMigratedDatabase();
    const repoPath = createRepoFixture();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-workspaces-"));

    expect(() =>
      withDatabase(databasePath, (context) => {
        const project = createProject(context, {
          id: "project-branch",
          name: "coordinator",
          repoPath,
          defaultBranch: "main",
          workspaceRoot
        });
        const task = createTask(context, { id: "task-branch", projectId: project.id, title: "workspace" });
        const attempt = createAttempt(context, { id: "attempt-branch", projectId: project.id, taskId: task.id });
        createAttemptWorkspace(context, {
          attemptId: attempt.id,
          owner: "worker-1",
          gitRunner: createFakeGitRunner({ existingBranch: "coordinator/task-branch/attempt-branch" }).runner
        });
      })
    ).toThrow(WorkspaceManagerError);

    const operation = withDatabase(databasePath, (context) =>
      getOperationByIdempotencyKey(context, "workspace:create:attempt-branch")
    );
    expect(operation?.status).toBe("failed");
  });

  it("creating workspace 外部 worktree 已存在且匹配时可收敛为 ready", () => {
    const databasePath = createMigratedDatabase();
    const repoPath = createRepoFixture();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-workspaces-"));

    const result = withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-reconcile",
        name: "coordinator",
        repoPath,
        defaultBranch: "main",
        workspaceRoot
      });
      const task = createTask(context, { id: "task-reconcile", projectId: project.id, title: "workspace" });
      const attempt = createAttempt(context, { id: "attempt-reconcile", projectId: project.id, taskId: task.id });
      const workspacePath = join(workspaceRoot, "project-reconcile", "task-reconcile", "attempt-reconcile");
      const repoWorktreePath = join(workspacePath, "repo");
      mkdirSync(repoWorktreePath, { recursive: true });
      mkdirSync(join(repoWorktreePath, ".git"));
      createWorkspace(context, {
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        status: "creating",
        workspacePath,
        repoPath: repoWorktreePath,
        branch: "coordinator/task-reconcile/attempt-reconcile",
        baseBranch: "main"
      });
      const git = createFakeGitRunner({
        existingBranch: "coordinator/task-reconcile/attempt-reconcile",
        currentBranch: "coordinator/task-reconcile/attempt-reconcile"
      });
      const created = createAttemptWorkspace(context, { attemptId: attempt.id, owner: "worker-1", gitRunner: git.runner });
      return { created, calls: git.calls };
    });

    expect(result.created.workspace.status).toBe("ready");
    expect(result.calls.some((call) => call[0] === "worktree" && call[1] === "add")).toBe(false);
    expect(result.calls).toContainEqual(["rev-parse", "--is-inside-work-tree"]);
    expect(result.calls).toContainEqual(["branch", "--show-current"]);
  });

  it("creating workspace 外部 branch 不匹配时不会收敛为 ready", () => {
    const databasePath = createMigratedDatabase();
    const repoPath = createRepoFixture();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-workspaces-"));

    expect(() =>
      withDatabase(databasePath, (context) => {
        const project = createProject(context, {
          id: "project-reconcile-bad",
          name: "coordinator",
          repoPath,
          defaultBranch: "main",
          workspaceRoot
        });
        const task = createTask(context, { id: "task-reconcile-bad", projectId: project.id, title: "workspace" });
        const attempt = createAttempt(context, { id: "attempt-reconcile-bad", projectId: project.id, taskId: task.id });
        const workspacePath = join(workspaceRoot, "project-reconcile-bad", "task-reconcile-bad", "attempt-reconcile-bad");
        const repoWorktreePath = join(workspacePath, "repo");
        mkdirSync(repoWorktreePath, { recursive: true });
        mkdirSync(join(repoWorktreePath, ".git"));
        createWorkspace(context, {
          projectId: project.id,
          taskId: task.id,
          attemptId: attempt.id,
          status: "creating",
          workspacePath,
          repoPath: repoWorktreePath,
          branch: "coordinator/task-reconcile-bad/attempt-reconcile-bad",
          baseBranch: "main"
        });
        createAttemptWorkspace(context, {
          attemptId: attempt.id,
          owner: "worker-1",
          gitRunner: createFakeGitRunner({
            existingBranch: "coordinator/task-reconcile-bad/attempt-reconcile-bad",
            currentBranch: "wrong-branch"
          }).runner
        });
      })
    ).toThrow(WorkspaceManagerError);
  });

  it("未过期 attempt lock 会拒绝创建 workspace，过期后可接管", () => {
    const databasePath = createMigratedDatabase();
    const repoPath = createRepoFixture();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-workspaces-"));

    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-lock",
        name: "coordinator",
        repoPath,
        defaultBranch: "main",
        workspaceRoot
      });
      const task = createTask(context, { id: "task-lock", projectId: project.id, title: "workspace" });
      const attempt = createAttempt(context, { id: "attempt-lock", projectId: project.id, taskId: task.id });
      acquireLock(context, {
        resourceKind: "attempt",
        resourceId: attempt.id,
        owner: "other-worker",
        ttlMs: 1000,
        now: new Date("2026-05-03T00:00:00.000Z")
      });

      expect(() =>
        createAttemptWorkspace(context, {
          attemptId: attempt.id,
          owner: "worker-1",
          ttlMs: 1000,
          now: new Date("2026-05-03T00:00:00.500Z"),
          gitRunner: createFakeGitRunner({ currentBranch: "coordinator/task-lock/attempt-lock" }).runner
        })
      ).toThrow(ActiveResourceConflictError);
      expect(getOperationByIdempotencyKey(context, "workspace:create:attempt-lock")?.status).toBe("planned");

      const result = createAttemptWorkspace(context, {
        attemptId: attempt.id,
        owner: "worker-1",
        ttlMs: 1000,
        now: new Date("2026-05-03T00:00:02.000Z"),
        gitRunner: createFakeGitRunner({ currentBranch: "coordinator/task-lock/attempt-lock" }).runner
      });
      expect(result.workspace.status).toBe("ready");
    });
  });

  it("workspace lock 冲突不会把共享 operation 标记为 failed", () => {
    const databasePath = createMigratedDatabase();
    const repoPath = createRepoFixture();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-workspaces-"));

    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-workspace-lock",
        name: "coordinator",
        repoPath,
        defaultBranch: "main",
        workspaceRoot
      });
      const task = createTask(context, { id: "task-workspace-lock", projectId: project.id, title: "workspace" });
      const attempt = createAttempt(context, {
        id: "attempt-workspace-lock",
        projectId: project.id,
        taskId: task.id
      });
      const workspace = createWorkspace(context, {
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        status: "creating",
        workspacePath: join(workspaceRoot, "project-workspace-lock", "task-workspace-lock", "attempt-workspace-lock"),
        repoPath: join(workspaceRoot, "project-workspace-lock", "task-workspace-lock", "attempt-workspace-lock", "repo"),
        branch: "coordinator/task-workspace-lock/attempt-workspace-lock",
        baseBranch: "main"
      });
      acquireLock(context, {
        resourceKind: "workspace",
        resourceId: workspace.id,
        owner: "other-worker",
        ttlMs: 1000,
        now: new Date("2026-05-03T00:00:00.000Z")
      });

      expect(() =>
        createAttemptWorkspace(context, {
          attemptId: attempt.id,
          owner: "worker-1",
          ttlMs: 1000,
          now: new Date("2026-05-03T00:00:00.500Z"),
          gitRunner: createFakeGitRunner({ currentBranch: "coordinator/task-workspace-lock/attempt-workspace-lock" }).runner
        })
      ).toThrow(ActiveResourceConflictError);
      expect(getOperationByIdempotencyKey(context, "workspace:create:attempt-workspace-lock")?.status).toBe("running");
    });
  });

  it("resume preflight 成功时返回 ok", () => {
    const databasePath = createMigratedDatabase();
    const repoPath = createRepoFixture();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-workspaces-"));

    const result = withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-preflight",
        name: "coordinator",
        repoPath,
        defaultBranch: "main",
        workspaceRoot
      });
      const task = createTask(context, { id: "task-1", projectId: project.id, title: "workspace" });
      const attempt = createAttempt(context, { id: "attempt-1", projectId: project.id, taskId: task.id });
      const created = createAttemptWorkspace(context, {
        attemptId: attempt.id,
        owner: "worker-1",
        gitRunner: createFakeGitRunner({ currentBranch: "coordinator/task-1/attempt-1" }).runner
      });
      return resumeWorkspacePreflight(context, {
        workspaceId: created.workspace.id,
        gitRunner: createFakeGitRunner({ currentBranch: "coordinator/task-1/attempt-1" }).runner
      });
    });

    expect(result.status).toBe("ok");
    expect(result.markdown).toContain("状态：ok");
  });

  it("resume preflight 发现 branch mismatch 或 dirty 时 blocked", () => {
    const databasePath = createMigratedDatabase();
    const repoPath = createRepoFixture();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-workspaces-"));

    const result = withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-preflight-block",
        name: "coordinator",
        repoPath,
        defaultBranch: "main",
        workspaceRoot
      });
      const task = createTask(context, { id: "task-1", projectId: project.id, title: "workspace" });
      const attempt = createAttempt(context, { id: "attempt-1", projectId: project.id, taskId: task.id });
      const created = createAttemptWorkspace(context, {
        attemptId: attempt.id,
        owner: "worker-1",
        gitRunner: createFakeGitRunner({ currentBranch: "coordinator/task-1/attempt-1" }).runner
      });
      return {
        branch: resumeWorkspacePreflight(context, {
          workspaceId: created.workspace.id,
          gitRunner: createFakeGitRunner({ currentBranch: "other-branch" }).runner
        }),
        dirty: resumeWorkspacePreflight(context, {
          workspaceId: created.workspace.id,
          gitRunner: createFakeGitRunner({ currentBranch: "coordinator/task-1/attempt-1", dirty: true }).runner
        })
      };
    });

    expect(result.branch.status).toBe("blocked");
    expect(result.branch.checks.find((check) => check.name === "branch")?.summary).toContain("branch mismatch");
    expect(result.dirty.status).toBe("blocked");
    expect(result.dirty.checks.find((check) => check.name === "git-status")?.summary).toContain("dirty");
  });

  it("resume preflight path containment 失败后不继续执行 git", () => {
    const databasePath = createMigratedDatabase();
    const repoPath = createRepoFixture();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-workspaces-"));
    const outsideRepo = mkdtempSync(join(tmpdir(), "coordinator-outside-repo-"));

    const result = withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-preflight-path",
        name: "coordinator",
        repoPath,
        defaultBranch: "main",
        workspaceRoot
      });
      const task = createTask(context, { id: "task-preflight-path", projectId: project.id, title: "workspace" });
      const attempt = createAttempt(context, {
        id: "attempt-preflight-path",
        projectId: project.id,
        taskId: task.id
      });
      const workspace = createWorkspace(context, {
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        status: "ready",
        workspacePath: join(workspaceRoot, "project-preflight-path", "task-preflight-path", "attempt-preflight-path"),
        repoPath: outsideRepo,
        branch: "coordinator/task-preflight-path/attempt-preflight-path",
        baseBranch: "main"
      });
      const git = createFakeGitRunner();
      return { preflight: resumeWorkspacePreflight(context, { workspaceId: workspace.id, gitRunner: git.runner }), calls: git.calls };
    });

    expect(result.preflight.status).toBe("blocked");
    expect(result.calls).toHaveLength(0);
  });

  it("resume preflight workspace path 缺失时只读失败且不创建目录", () => {
    const databasePath = createMigratedDatabase();
    const repoPath = createRepoFixture();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-workspaces-"));
    const missingWorkspacePath = join(workspaceRoot, "project-missing", "task-missing", "attempt-missing");

    const result = withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-missing",
        name: "coordinator",
        repoPath,
        defaultBranch: "main",
        workspaceRoot
      });
      const task = createTask(context, { id: "task-missing", projectId: project.id, title: "workspace" });
      const attempt = createAttempt(context, { id: "attempt-missing", projectId: project.id, taskId: task.id });
      const workspace = createWorkspace(context, {
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        status: "ready",
        workspacePath: missingWorkspacePath,
        repoPath: join(missingWorkspacePath, "repo"),
        branch: "coordinator/task-missing/attempt-missing",
        baseBranch: "main"
      });
      const git = createFakeGitRunner();
      return { preflight: resumeWorkspacePreflight(context, { workspaceId: workspace.id, gitRunner: git.runner }), calls: git.calls };
    });

    expect(result.preflight.status).toBe("blocked");
    expect(result.preflight.checks).toHaveLength(1);
    expect(result.preflight.checks[0].name).toBe("workspace-path");
    expect(result.calls).toHaveLength(0);
    expect(existsSync(missingWorkspacePath)).toBe(false);
  });

  it("resume preflight 拒绝 coordinator symlink escape", () => {
    const databasePath = createMigratedDatabase();
    const repoPath = createRepoFixture();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-workspaces-"));
    const outside = mkdtempSync(join(tmpdir(), "coordinator-outside-"));

    const result = withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-preflight-symlink",
        name: "coordinator",
        repoPath,
        defaultBranch: "main",
        workspaceRoot
      });
      const task = createTask(context, { id: "task-preflight-symlink", projectId: project.id, title: "workspace" });
      const attempt = createAttempt(context, {
        id: "attempt-preflight-symlink",
        projectId: project.id,
        taskId: task.id
      });
      const workspacePath = join(
        workspaceRoot,
        "project-preflight-symlink",
        "task-preflight-symlink",
        "attempt-preflight-symlink"
      );
      mkdirSync(workspacePath, { recursive: true });
      mkdirSync(join(workspacePath, "repo"), { recursive: true });
      symlinkSync(outside, join(workspacePath, "coordinator"));
      const workspace = createWorkspace(context, {
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        status: "ready",
        workspacePath,
        repoPath: join(workspacePath, "repo"),
        branch: "coordinator/task-preflight-symlink/attempt-preflight-symlink",
        baseBranch: "main"
      });
      const git = createFakeGitRunner();
      return { preflight: resumeWorkspacePreflight(context, { workspaceId: workspace.id, gitRunner: git.runner }), calls: git.calls };
    });

    expect(result.preflight.status).toBe("blocked");
    expect(result.preflight.checks.find((check) => check.name === "coordinator-path")?.summary).toContain("realpath");
    expect(result.calls).toHaveLength(0);
  });

  it("workspace root symlink escape 会被拒绝", () => {
    const databasePath = createMigratedDatabase();
    const repoPath = createRepoFixture();
    const safeRoot = mkdtempSync(join(tmpdir(), "coordinator-safe-root-"));
    const outside = mkdtempSync(join(tmpdir(), "coordinator-outside-"));
    mkdirSync(join(safeRoot, "project-symlink", "task-symlink"), { recursive: true });
    symlinkSync(outside, join(safeRoot, "project-symlink", "task-symlink", "attempt-symlink"));

    expect(() =>
      withDatabase(databasePath, (context) => {
        const project = createProject(context, {
          id: "project-symlink",
          name: "coordinator",
          repoPath,
          defaultBranch: "main",
          workspaceRoot: safeRoot
        });
        const task = createTask(context, { id: "task-symlink", projectId: project.id, title: "workspace" });
        const attempt = createAttempt(context, { id: "attempt-symlink", projectId: project.id, taskId: task.id });
        createAttemptWorkspace(context, {
          attemptId: attempt.id,
          owner: "worker-1",
          gitRunner: createFakeGitRunner({ currentBranch: "coordinator/task-symlink/attempt-symlink" }).runner
        });
      })
    ).toThrow(WorkspacePathError);
  });
});
