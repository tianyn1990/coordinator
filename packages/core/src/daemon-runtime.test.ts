import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendEvent,
  acquireLock,
  createAgentSession,
  createAttempt,
  createExecutionPlan,
  createHumanRequest,
  createOperation,
  createProject,
  createPullRequest,
  createTask,
  createWorkspace,
  getLock,
  getLatestPullRequestByTask,
  getOperationByIdempotencyKey,
  listTaskEvents,
  runMigrations,
  updateHumanRequest,
  updateOperation,
  withDatabase,
  type DbContext
} from "@coordinator/db";
import {
  FakeAgentProvider,
  FakePullRequestProvider,
  buildTaskSurfaceFromDb,
  invokeWorkflowAction,
  parseAgentToolRequest,
  runDaemonTick,
  type AgentProviderRunInput,
  type PullRequestProviderReviewInput,
  type PullRequestProviderReviewResult,
  type WorkflowProtocolRunner
} from "./index.js";
import { persistRecoveryDecision, type RecoveryDecision } from "./recovery-decision.js";

function createReadyWorkspaceFixture(databasePath: string, suffix: string, options: { dirty?: boolean; currentBranch?: string } = {}) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), `coordinator-daemon-workspaces-${suffix}-`));
  return withDatabase(databasePath, (context) => {
    const project = createProject(context, {
      id: `project-${suffix}`,
      name: "daemon",
      workspaceRoot,
      defaultBranch: "main",
      workflowLauncher: "workflow",
      outerAgentDefaultProvider: "fake"
    });
    const task = createTask(context, {
      id: `task-${suffix}`,
      projectId: project.id,
      title: "daemon task"
    });
    const attempt = createAttempt(context, { id: `attempt-${suffix}`, projectId: project.id, taskId: task.id });
    const workspacePath = join(workspaceRoot, project.id, task.id, attempt.id);
    const repoPath = join(workspacePath, "repo");
    const coordinatorPath = join(workspacePath, "coordinator");
    const artifactRoot = join(coordinatorPath, "artifacts");
    mkdirSync(join(repoPath, ".git"), { recursive: true });
    mkdirSync(artifactRoot, { recursive: true });
    const branch = `coordinator/${task.id}/${attempt.id}`;
    const workspace = createWorkspace(context, {
      id: `workspace-${suffix}`,
      projectId: project.id,
      taskId: task.id,
      attemptId: attempt.id,
      status: "ready",
      workspacePath,
      repoPath,
      branch,
      baseBranch: "main"
    });
    writeFileSync(join(coordinatorPath, "ownership.json"), JSON.stringify({
      projectId: project.id,
      taskId: task.id,
      attemptId: attempt.id,
      workspaceId: workspace.id,
      branch,
      baseBranch: "main",
      owner: "test",
      lockToken: "redacted-token",
      createdAt: "2026-05-03T00:00:00.000Z"
    }));
    writeFileSync(join(artifactRoot, "checkpoint.md"), "# checkpoint\n");
    const workspaceGitRunner = (args: string[]) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return "true\n";
      if (args[0] === "branch") return `${options.currentBranch ?? branch}\n`;
      if (args[0] === "status") return options.dirty ? " M file.ts\n" : "";
      return "";
    };
    return { projectId: project.id, taskId: task.id, attemptId: attempt.id, workspaceId: workspace.id, workspaceGitRunner };
  });
}

function createWorkflowWorkspaceFixture(
  context: DbContext,
  fixture: { projectId: string; taskId: string; workspaceRoot: string },
  workflowRunId: string
) {
  const workspacePath = join(fixture.workspaceRoot, fixture.projectId, fixture.taskId, workflowRunId);
  const repoPath = join(workspacePath, "repo");
  const coordinatorPath = join(workspacePath, "coordinator");
  const artifactRoot = join(coordinatorPath, "artifacts");
  mkdirSync(join(repoPath, ".git"), { recursive: true });
  mkdirSync(artifactRoot, { recursive: true });
  createExecutionPlan(context, {
    projectId: fixture.projectId,
    taskId: fixture.taskId,
    status: "active",
    artifactPath: "execution-plan.md"
  });
  const attempt = createAttempt(context, { projectId: fixture.projectId, taskId: fixture.taskId });
  const branch = `coordinator/${fixture.taskId}/${attempt.id}`;
  const workspace = createWorkspace(context, {
    projectId: fixture.projectId,
    taskId: fixture.taskId,
    attemptId: attempt.id,
    status: "ready",
    workspacePath,
    repoPath,
    branch,
    baseBranch: "main"
  });
  writeFileSync(join(coordinatorPath, "ownership.json"), JSON.stringify({
    projectId: fixture.projectId,
    taskId: fixture.taskId,
    attemptId: attempt.id,
    workspaceId: workspace.id,
    branch,
    baseBranch: "main",
    owner: "test",
    lockToken: "redacted-token",
    createdAt: "2026-05-03T00:00:00.000Z"
  }));
  writeFileSync(join(artifactRoot, "checkpoint.md"), "# checkpoint\n");
  return { attempt, workspace, branch };
}

function createWorkflowWorkspaceGitRunner(expectedBranch: string) {
  return (args: string[]) => {
    if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return "true\n";
    if (args[0] === "branch") return `${expectedBranch}\n`;
    if (args[0] === "status") return "";
    return "";
  };
}

function createMigratedDatabase(): string {
  const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-daemon-db-")), "daemon.sqlite");
  runMigrations(databasePath);
  return databasePath;
}

function createTaskFixture(databasePath: string) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-daemon-workspaces-"));
  const ids = withDatabase(databasePath, (context) => {
    const project = createProject(context, {
      id: "project-daemon",
      name: "daemon",
      workspaceRoot,
      defaultBranch: "main",
      workflowLauncher: "workflow",
      outerAgentDefaultProvider: "fake"
    });
    const task = createTask(context, {
      id: "task-daemon",
      projectId: project.id,
      title: "daemon task",
      description: "run daemon"
    });
    return { projectId: project.id, taskId: task.id };
  });
  return { ...ids, workspaceRoot };
}

function writeTaskArtifact(workspaceRoot: string, relativePath: string, content: string): void {
  const artifactRoot = join(workspaceRoot, "project-daemon", "task-daemon", "_task", "coordinator", "artifacts");
  const dirname = relativePath.split("/").slice(0, -1).join("/");
  mkdirSync(dirname ? join(artifactRoot, dirname) : artifactRoot, { recursive: true });
  writeFileSync(join(artifactRoot, relativePath), content);
}

describe("daemon runtime", () => {
  it("解析一层 coordinator-tool 文本协议，不要求 agent 手写复杂 JSON", () => {
    const request = parseAgentToolRequest([
      "准备执行计划。",
      "",
      "```coordinator-tool",
      "tool: write_execution_plan",
      "artifact: execution-plan.md",
      "```"
    ].join("\n"));

    expect(request).toEqual({
      toolName: "write_execution_plan",
      args: { artifact: "execution-plan.md" }
    });
  });

  it("daemon 会先落 coordinator-artifact，再执行 artifact-based tool", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);

    const provider = new FakeAgentProvider(
      [
        "```coordinator-artifact",
        "path: execution-plan.md",
        "content:",
        "# Plan",
        "",
        "1. create attempt",
        "```",
        "",
        "```coordinator-tool",
        "tool: write_execution_plan",
        "artifact: execution-plan.md",
        "```"
      ].join("\n")
    );

    const result = withDatabase(databasePath, (context) => runDaemonTick(context, { provider }));

    expect(result.actions).toContainEqual(
      expect.objectContaining({
        kind: "agent_tool_executed",
        toolName: "write_execution_plan",
        status: "succeeded"
      })
    );
    const surface = withDatabase(databasePath, (context) => buildTaskSurfaceFromDb(context, fixture.taskId));
    expect(surface.json.execution_plan).toMatchObject({ artifact_path: "execution-plan.md", status: "active" });
  });

  it("非 artifact tool 携带 artifact 时记录 extra artifact debug event", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    withDatabase(databasePath, (context) => {
      createExecutionPlan(context, {
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        status: "active",
        artifactPath: "execution-plan.md"
      });
    });
    const provider = new FakeAgentProvider(
      [
        "```coordinator-artifact",
        "path: note.md",
        "content:",
        "# Extra",
        "```",
        "",
        "```coordinator-tool",
        "tool: create_attempt",
        "reason: initial",
        "```"
      ].join("\n")
    );

    const result = withDatabase(databasePath, (context) => runDaemonTick(context, { provider }));

    expect(result.actions).toContainEqual(
      expect.objectContaining({
        kind: "agent_tool_executed",
        toolName: "create_attempt",
        status: "succeeded"
      })
    );
    const events = withDatabase(databasePath, (context) => listTaskEvents(context, fixture.taskId));
    const extraEvent = events.find((event) => event.type === "daemon.agent_extra_artifact_written");
    expect(extraEvent).toMatchObject({
      artifactRefs: ["note.md"],
      severity: "debug"
    });
    expect(extraEvent?.payload).toMatchObject({
      toolName: "create_attempt",
      artifactCount: 1,
      artifactRefs: ["note.md"],
      classification: "extra-artifact-for-non-artifact-tool"
    });
    expect(JSON.stringify(extraEvent?.payload)).not.toContain("# Extra");
  });

  it("update_pr 仅改标题时携带 artifact 也归类为 extra artifact", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    withDatabase(databasePath, (context) => {
      const attempt = createAttempt(context, {
        projectId: fixture.projectId,
        taskId: fixture.taskId
      });
      createPullRequest(context, {
        id: "pr-extra-artifact",
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        attemptId: attempt.id,
        providerKind: "fake",
        externalId: "fake-pr-extra",
        status: "open"
      });
    });
    const provider = new FakeAgentProvider(
      [
        "```coordinator-artifact",
        "path: pr-note.md",
        "content:",
        "# Note",
        "```",
        "",
        "```coordinator-tool",
        "tool: update_pr",
        "pr: pr-extra-artifact",
        "title: 只改标题",
        "```"
      ].join("\n")
    );

    const result = withDatabase(databasePath, (context) =>
      runDaemonTick(context, { provider, pullRequestProvider: new FakePullRequestProvider() })
    );

    const events = withDatabase(databasePath, (context) => listTaskEvents(context, fixture.taskId));
    expect(events.find((event) => event.type === "daemon.agent_extra_artifact_written")?.payload).toMatchObject({
      toolName: "update_pr",
      artifactRefs: ["pr-note.md"]
    });
  });

  it("daemon artifact bridge 拒绝通过 symlink 写出 artifact_root", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const outside = mkdtempSync(join(tmpdir(), "coordinator-daemon-outside-"));
    const artifactRoot = join(fixture.workspaceRoot, "project-daemon", "task-daemon", "_task", "coordinator", "artifacts");
    mkdirSync(artifactRoot, { recursive: true });
    symlinkSync(outside, join(artifactRoot, "escape"));

    const provider = new FakeAgentProvider(
      [
        "```coordinator-artifact",
        "path: escape/execution-plan.md",
        "content:",
        "# Plan",
        "```",
        "",
        "```coordinator-tool",
        "tool: write_execution_plan",
        "artifact: escape/execution-plan.md",
        "```"
      ].join("\n")
    );

    const result = withDatabase(databasePath, (context) => runDaemonTick(context, { provider }));

    expect(result.actions).toContainEqual(
      expect.objectContaining({
        kind: "retry_blocked",
        summary: expect.stringContaining("scheduled for retry")
      })
    );
    const events = withDatabase(databasePath, (context) => listTaskEvents(context, fixture.taskId));
    expect(events.find((event) => event.type === "daemon.advance_failed")?.payload).toMatchObject({
      errorName: "DaemonRuntimeError"
    });
  });

  it("daemon artifact bridge 拒绝覆盖指向 root 外的文件 symlink", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const outside = mkdtempSync(join(tmpdir(), "coordinator-daemon-outside-file-"));
    const artifactRoot = join(fixture.workspaceRoot, "project-daemon", "task-daemon", "_task", "coordinator", "artifacts");
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(join(outside, "target.md"), "outside");
    symlinkSync(join(outside, "target.md"), join(artifactRoot, "execution-plan.md"));

    const provider = new FakeAgentProvider(
      [
        "```coordinator-artifact",
        "path: execution-plan.md",
        "content:",
        "# Plan",
        "```",
        "",
        "```coordinator-tool",
        "tool: write_execution_plan",
        "artifact: execution-plan.md",
        "```"
      ].join("\n")
    );

    const result = withDatabase(databasePath, (context) => runDaemonTick(context, { provider }));

    expect(result.actions).toContainEqual(
      expect.objectContaining({
        kind: "retry_blocked",
        summary: expect.stringContaining("scheduled for retry")
      })
    );
    const events = withDatabase(databasePath, (context) => listTaskEvents(context, fixture.taskId));
    expect(events.find((event) => event.type === "daemon.advance_failed")?.payload).toMatchObject({
      errorName: "DaemonRuntimeError"
    });
  });

  it("daemon tick 启动 outer agent 并执行其请求的可见工具", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    writeTaskArtifact(fixture.workspaceRoot, "execution-plan.md", "# Plan\n\n1. create attempt\n");

    const provider = new FakeAgentProvider("```coordinator-tool\ntool: write_execution_plan\nartifact: execution-plan.md\n```");

    const result = withDatabase(databasePath, (context) => runDaemonTick(context, { provider }));

    expect(result.status).toBe("acted");
    expect(result.actions).toContainEqual(
      expect.objectContaining({
        kind: "agent_tool_executed",
        taskId: fixture.taskId,
        toolName: "write_execution_plan",
        status: "succeeded"
      })
    );

    const surface = withDatabase(databasePath, (context) => buildTaskSurfaceFromDb(context, fixture.taskId));
    expect(surface.json.execution_plan).toMatchObject({ artifact_path: "execution-plan.md", status: "active" });
    expect(surface.json.available_tools.map((tool) => tool.name)).toContain("create_attempt");
  });

  it("agent 没有请求工具时 daemon 不猜测下一步", () => {
    const databasePath = createMigratedDatabase();
    createTaskFixture(databasePath);

    const result = withDatabase(databasePath, (context) =>
      runDaemonTick(context, { provider: new FakeAgentProvider("只输出建议，不请求工具。") })
    );

    expect(result.actions).toContainEqual(
      expect.objectContaining({
        kind: "agent_tool_skipped",
        status: "skipped"
      })
    );
    const events = withDatabase(databasePath, (context) => listTaskEvents(context, "task-daemon"));
    expect(events.map((event) => event.type)).toContain("daemon.agent_tool_skipped");
  });

  it("同一 task stateVersion 已处理后 daemon 不重复启动 agent session", () => {
    const databasePath = createMigratedDatabase();
    createTaskFixture(databasePath);

    const first = withDatabase(databasePath, (context) =>
      runDaemonTick(context, { provider: new FakeAgentProvider("只输出建议，不请求工具。") })
    );
    const second = withDatabase(databasePath, (context) =>
      runDaemonTick(context, { provider: new FakeAgentProvider("第二次不应真正运行。") })
    );

    expect(first.actions).toContainEqual(expect.objectContaining({ kind: "agent_tool_skipped" }));
    expect(second.actions).toContainEqual(
      expect.objectContaining({
        kind: "agent_tool_skipped",
        summary: "task snapshot already processed: daemon-planning:task-v0:attempt-none-none:workspace-none-none:workflow-none-none-none"
      })
    );
    const events = withDatabase(databasePath, (context) => listTaskEvents(context, "task-daemon"));
    expect(events.filter((event) => event.type === "agent.session_completed")).toHaveLength(1);
  });

  it("attempt 创建后即使 task stateVersion 不变，daemon 也能基于新 surface 继续推进", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    writeTaskArtifact(fixture.workspaceRoot, "execution-plan.md", "# Plan\n\n1. create attempt\n");

    withDatabase(databasePath, (context) =>
      runDaemonTick(context, { provider: new FakeAgentProvider("```coordinator-tool\ntool: write_execution_plan\nartifact: execution-plan.md\n```") })
    );
    withDatabase(databasePath, (context) =>
      runDaemonTick(context, { provider: new FakeAgentProvider("```coordinator-tool\ntool: create_attempt\nreason: initial\n```") })
    );
    const third = withDatabase(databasePath, (context) =>
      runDaemonTick(context, { provider: new FakeAgentProvider("```coordinator-tool\ntool: ask_human\nkind: smoke\nartifact: execution-plan.md\n```") })
    );

    expect(third.actions).toContainEqual(
      expect.objectContaining({
        kind: "agent_tool_executed",
        toolName: "ask_human",
        status: "succeeded"
      })
    );
    const events = withDatabase(databasePath, (context) => listTaskEvents(context, fixture.taskId));
    expect(events.filter((event) => event.type === "agent.session_completed")).toHaveLength(3);
    expect(events.map((event) => event.type)).not.toContain("daemon.agent_session_skipped");
  });

  it("daemon operation replay 匹配 intent 时标记 reconciled 并写窄 recovery event", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);

    withDatabase(databasePath, (context) => {
      const operation = createOperation(context, {
        idempotencyKey: "daemon:test:replay:matches",
        kind: "daemon:test",
        projectId: fixture.projectId,
        taskId: fixture.taskId
      });
      updateOperation(context, {
        operationId: operation.id,
        status: "running",
        lastObservedState: { observedExternalState: "matches-intent", providerRawOutput: "must-not-leak" }
      });
    });

    withDatabase(databasePath, (context) => runDaemonTick(context, { provider: new FakeAgentProvider("no-op") }));

    const state = withDatabase(databasePath, (context) => ({
      operation: getOperationByIdempotencyKey(context, "daemon:test:replay:matches"),
      events: listTaskEvents(context, fixture.taskId)
    }));
    expect(state.operation).toMatchObject({ status: "reconciled" });
    const recovery = state.events.find((event) => event.type === "daemon.recovery_decision");
    expect(recovery?.payload).toMatchObject({
      decision: "reconciled",
      reasonCode: "operation-matches-intent",
      resourceKind: "operation"
    });
    expect(JSON.stringify(recovery?.payload)).not.toContain("must-not-leak");
  });

  it("daemon 对安全的 expired workspace lock 先 inspect 再按 leaseVersion 释放", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createReadyWorkspaceFixture(databasePath, "lock-release");
    const now = new Date("2026-05-03T00:00:02.000Z");
    let lockToken = "";

    withDatabase(databasePath, (context) => {
      const lock = acquireLock(context, {
        resourceKind: "workspace",
        resourceId: fixture.workspaceId,
        owner: "old-owner",
        ttlMs: 1000,
        now: new Date("2026-05-03T00:00:00.000Z")
      });
      lockToken = lock.lockToken;
    });

    const result = withDatabase(databasePath, (context) => runDaemonTick(context, {
      now,
      provider: new FakeAgentProvider("no-op"),
      workspaceGitRunner: fixture.workspaceGitRunner
    }));

    expect(result.actions).toContainEqual(expect.objectContaining({ kind: "lock_reconciled", workspaceId: fixture.workspaceId }));
    const state = withDatabase(databasePath, (context) => ({
      lock: getLock(context, "workspace", fixture.workspaceId),
      events: listTaskEvents(context, fixture.taskId)
    }));
    expect(state.lock).toBeUndefined();
    const payloadText = JSON.stringify(state.events);
    expect(payloadText).toContain("expired-lock-safe-to-release");
    expect(payloadText).not.toContain(lockToken);
    expect(payloadText).not.toContain("redacted-token");
  });

  it("task-scoped expired lock 先按 task 过滤再 LIMIT", () => {
    const databasePath = createMigratedDatabase();
    const target = createReadyWorkspaceFixture(databasePath, "lock-target-scope");
    const now = new Date("2026-05-03T00:00:10.000Z");

    withDatabase(databasePath, (context) => {
      for (let index = 0; index < 6; index += 1) {
        const other = createReadyWorkspaceFixture(databasePath, `lock-other-${index}`);
        acquireLock(context, {
          resourceKind: "workspace",
          resourceId: other.workspaceId,
          owner: "old-owner",
          ttlMs: 1000,
          now: new Date(`2026-05-03T00:00:0${index}.000Z`)
        });
      }
      acquireLock(context, {
        resourceKind: "workspace",
        resourceId: target.workspaceId,
        owner: "old-owner",
        ttlMs: 1000,
        now: new Date("2026-05-03T00:00:07.000Z")
      });
    });

    const result = withDatabase(databasePath, (context) =>
      runDaemonTick(context, {
        taskId: target.taskId,
        candidateLimit: 1,
        now,
        provider: new FakeAgentProvider("no-op"),
        workspaceGitRunner: target.workspaceGitRunner
      })
    );

    expect(result.actions).toContainEqual(
      expect.objectContaining({
        kind: "lock_reconciled",
        taskId: target.taskId,
        workspaceId: target.workspaceId
      })
    );
    const lock = withDatabase(databasePath, (context) => getLock(context, "workspace", target.workspaceId));
    expect(lock).toBeUndefined();
  });

  it("daemon 对 owner active 的 expired workspace lock 不释放", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createReadyWorkspaceFixture(databasePath, "lock-owner-active");
    const now = new Date("2026-05-03T00:00:02.000Z");

    withDatabase(databasePath, (context) => {
      acquireLock(context, {
        resourceKind: "workspace",
        resourceId: fixture.workspaceId,
        owner: "old-owner",
        ttlMs: 1000,
        now: new Date("2026-05-03T00:00:00.000Z")
      });
      createAgentSession(context, {
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        attemptId: fixture.attemptId,
        providerKind: "fake",
        role: "outer",
        status: "running"
      });
    });

    withDatabase(databasePath, (context) => runDaemonTick(context, {
      now,
      provider: new FakeAgentProvider("no-op"),
      workspaceGitRunner: fixture.workspaceGitRunner
    }));

    const state = withDatabase(databasePath, (context) => ({
      lock: getLock(context, "workspace", fixture.workspaceId),
      events: listTaskEvents(context, fixture.taskId)
    }));
    expect(state.lock).toBeDefined();
    expect(state.events.find((event) => event.type === "daemon.recovery_decision")?.payload).toMatchObject({
      reasonCode: "expired-lock-owner-active",
      operatorAttentionRequired: true
    });
  });

  it("daemon 对存在 active operation 的 expired workspace lock 不释放", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createReadyWorkspaceFixture(databasePath, "lock-operation-active");
    const now = new Date("2026-05-03T00:00:02.000Z");

    withDatabase(databasePath, (context) => {
      acquireLock(context, {
        resourceKind: "workspace",
        resourceId: fixture.workspaceId,
        owner: "old-owner",
        ttlMs: 1000,
        now: new Date("2026-05-03T00:00:00.000Z")
      });
      const operation = createOperation(context, {
        idempotencyKey: "workspace:create:attempt-lock-operation-active",
        kind: "workspace:create",
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        attemptId: fixture.attemptId
      });
      updateOperation(context, { operationId: operation.id, status: "running" });
    });

    withDatabase(databasePath, (context) => runDaemonTick(context, {
      now,
      provider: new FakeAgentProvider("no-op"),
      workspaceGitRunner: fixture.workspaceGitRunner
    }));

    const state = withDatabase(databasePath, (context) => ({
      lock: getLock(context, "workspace", fixture.workspaceId),
      events: listTaskEvents(context, fixture.taskId)
    }));
    expect(state.lock).toBeDefined();
    expect(state.events.find((event) => event.type === "daemon.recovery_decision")?.payload).toMatchObject({
      reasonCode: "expired-lock-owner-active",
      operatorAttentionRequired: true
    });
  });


  it("Core recovery release 前 leaseVersion 变化时不释放当前 lock", () => {
    const databasePath = createMigratedDatabase();
    const now = new Date("2026-05-03T00:00:02.000Z");

    withDatabase(databasePath, (context) => {
      const first = acquireLock(context, {
        resourceKind: "workspace",
        resourceId: "workspace-lease-changed",
        owner: "old-owner",
        ttlMs: 1000,
        now: new Date("2026-05-03T00:00:00.000Z")
      });
      const second = acquireLock(context, {
        resourceKind: "workspace",
        resourceId: "workspace-lease-changed",
        owner: "new-owner",
        ttlMs: 1000,
        now
      });
      const decision: RecoveryDecision = {
        kind: "reconciled",
        resourceKind: "lock",
        resourceId: "workspace:workspace-lease-changed",
        reasonCode: "expired-lock-safe-to-release",
        observedSummary: "lock expired; workspace safe",
        nextAction: "release_expired_lock"
      };

      expect(() =>
        persistRecoveryDecision(context, decision, {
          tickId: "tick-lease-changed",
          now,
          lockRelease: {
            resourceKind: "workspace",
            resourceId: "workspace-lease-changed",
            lockToken: first.lockToken,
            leaseVersion: first.leaseVersion
          }
        })
      ).toThrow(/lock lease changed/);
      expect(getLock(context, "workspace", "workspace-lease-changed")).toMatchObject({
        owner: "new-owner",
        lockToken: second.lockToken,
        leaseVersion: second.leaseVersion
      });
    });
  });

  it("Coordinator Surface 不新增 workspace/lock recovery agent tool", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);

    withDatabase(databasePath, (context) => {
      appendEvent(context, {
        type: "daemon.recovery_decision",
        summary: "workspace recovery observed",
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        payload: {
          reasonCode: "workspace-branch_mismatch",
          observedSummary: "workspace branch mismatch",
          lockToken: "must-not-enter-surface",
          leaseVersion: 99,
          fullManifest: { lockToken: "manifest-token" }
        }
      });
    });

    const surface = withDatabase(databasePath, (context) => buildTaskSurfaceFromDb(context, fixture.taskId));
    const text = JSON.stringify(surface.json.available_tools) + surface.markdown;
    expect(surface.json.available_tools.map((tool) => tool.name)).not.toContain("release_lock");
    expect(surface.json.available_tools.map((tool) => tool.name)).not.toContain("recover_workspace");
    expect(text).not.toContain("must-not-enter-surface");
    expect(text).not.toContain("manifest-token");
    expect(text).not.toContain("leaseVersion");
  });

  it("daemon 对 dirty unknown workspace 的 expired lock 不释放", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createReadyWorkspaceFixture(databasePath, "lock-dirty", { dirty: true });
    const now = new Date("2026-05-03T00:00:02.000Z");

    withDatabase(databasePath, (context) => {
      acquireLock(context, {
        resourceKind: "workspace",
        resourceId: fixture.workspaceId,
        owner: "old-owner",
        ttlMs: 1000,
        now: new Date("2026-05-03T00:00:00.000Z")
      });
    });

    withDatabase(databasePath, (context) => runDaemonTick(context, {
      now,
      provider: new FakeAgentProvider("no-op"),
      workspaceGitRunner: fixture.workspaceGitRunner
    }));

    const state = withDatabase(databasePath, (context) => ({
      lock: getLock(context, "workspace", fixture.workspaceId),
      events: listTaskEvents(context, fixture.taskId)
    }));
    expect(state.lock).toBeDefined();
    expect(state.events.find((event) => event.type === "daemon.recovery_decision")?.payload).toMatchObject({
      reasonCode: "workspace-dirty_unknown"
    });
    expect(JSON.stringify(state.events)).toContain("expired-lock-resource-unsafe");
  });

  it("workspace recovery operator attention 会阻止同 tick 启动 agent 和 workflow 工具", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createReadyWorkspaceFixture(databasePath, "workspace-block", { currentBranch: "wrong-branch" });
    const provider = new FakeAgentProvider("```coordinator-tool\ntool: start_workflow_run\n```");

    const result = withDatabase(databasePath, (context) => runDaemonTick(context, {
      provider,
      workspaceGitRunner: fixture.workspaceGitRunner
    }));

    expect(result.actions).toContainEqual(expect.objectContaining({
      kind: "workspace_inspected",
      taskId: fixture.taskId,
      workspaceId: fixture.workspaceId
    }));
    expect(result.actions.some((action) => action.kind === "agent_session_started")).toBe(false);
    expect(result.actions.some((action) => action.kind === "agent_tool_executed")).toBe(false);

    const state = withDatabase(databasePath, (context) => ({
      workspace: context.db.prepare("SELECT status FROM workspaces WHERE id = ?").get(fixture.workspaceId) as { status: string },
      surface: buildTaskSurfaceFromDb(context, fixture.taskId),
      events: listTaskEvents(context, fixture.taskId)
    }));
    expect(state.workspace.status).toBe("blocked");
    expect(state.surface.json.available_tools.map((tool) => tool.name)).not.toContain("start_workflow_run");
    expect(state.surface.markdown).toContain("workspace recovery");
    expect(state.events.find((event) => event.type === "daemon.recovery_decision")?.payload).toMatchObject({
      reasonCode: "workspace-branch_mismatch",
      operatorAttentionRequired: true
    });
  });

  it("daemon operation replay 冲突时进入 unknown/operator attention，不覆盖外部状态", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);

    withDatabase(databasePath, (context) => {
      const operation = createOperation(context, {
        idempotencyKey: "daemon:test:replay:conflict",
        kind: "daemon:test",
        projectId: fixture.projectId,
        taskId: fixture.taskId
      });
      updateOperation(context, {
        operationId: operation.id,
        status: "running",
        lastObservedState: { observedExternalState: "conflicts-with-intent" }
      });
    });

    withDatabase(databasePath, (context) => runDaemonTick(context, { provider: new FakeAgentProvider("no-op") }));

    const state = withDatabase(databasePath, (context) => ({
      operation: getOperationByIdempotencyKey(context, "daemon:test:replay:conflict"),
      events: listTaskEvents(context, fixture.taskId)
    }));
    expect(state.operation).toMatchObject({ status: "unknown" });
    expect(state.events.find((event) => event.type === "daemon.recovery_decision")?.payload).toMatchObject({
      decision: "operator_attention",
      reasonCode: "operation-conflicts-with-intent"
    });
  });

  it("daemon operation replay absent 会安排 retry 并封口，避免重复 tick 刷 recovery event", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);

    withDatabase(databasePath, (context) => {
      const operation = createOperation(context, {
        idempotencyKey: "daemon:test:replay:absent",
        kind: "daemon:test",
        projectId: fixture.projectId,
        taskId: fixture.taskId
      });
      updateOperation(context, {
        operationId: operation.id,
        status: "running",
        lastObservedState: { observedExternalState: "absent" }
      });
    });

    withDatabase(databasePath, (context) => runDaemonTick(context, { provider: new FakeAgentProvider("no-op") }));
    withDatabase(databasePath, (context) => runDaemonTick(context, { provider: new FakeAgentProvider("no-op") }));

    const state = withDatabase(databasePath, (context) => ({
      operation: getOperationByIdempotencyKey(context, "daemon:test:replay:absent"),
      events: listTaskEvents(context, fixture.taskId)
    }));
    expect(state.operation).toMatchObject({ status: "reconciled" });
    expect(state.events.map((event) => event.type)).toContain("daemon.retry_scheduled");
    expect(
      state.events.filter(
        (event) =>
          event.type === "daemon.recovery_decision" &&
          (event.payload as { reasonCode?: string } | undefined)?.reasonCode === "operation-absent-retryable"
      )
    ).toHaveLength(1);
  });

  it("daemon operation replay 不会被非 daemon operation backlog 挤出候选窗口", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);

    withDatabase(databasePath, (context) => {
      for (let index = 0; index < 3; index += 1) {
        const operation = createOperation(context, {
          idempotencyKey: `agent:session:backlog:${index}`,
          kind: "agent:session",
          projectId: fixture.projectId,
          taskId: fixture.taskId
        });
        updateOperation(context, {
          operationId: operation.id,
          status: "running",
          lastObservedState: { observedExternalState: "unclear" }
        });
      }
      const daemonOperation = createOperation(context, {
        idempotencyKey: "daemon:test:replay:not-starved",
        kind: "daemon:test",
        projectId: fixture.projectId,
        taskId: fixture.taskId
      });
      updateOperation(context, {
        operationId: daemonOperation.id,
        status: "running",
        lastObservedState: { observedExternalState: "matches-intent" }
      });
    });

    withDatabase(databasePath, (context) =>
      runDaemonTick(context, {
        provider: new FakeAgentProvider("no-op"),
        candidateLimit: 1
      })
    );

    const state = withDatabase(databasePath, (context) => ({
      operation: getOperationByIdempotencyKey(context, "daemon:test:replay:not-starved"),
      events: listTaskEvents(context, fixture.taskId)
    }));
    expect(state.operation).toMatchObject({ status: "reconciled" });
    expect(state.events.find((event) => event.type === "daemon.recovery_decision")?.payload).toMatchObject({
      reasonCode: "operation-matches-intent",
      resourceKind: "operation"
    });
  });

  it("task-scoped daemon tick 只推进指定 task", () => {
    const databasePath = createMigratedDatabase();
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-daemon-scoped",
        name: "daemon-scoped",
        workspaceRoot: mkdtempSync(join(tmpdir(), "coordinator-daemon-scoped-workspaces-")),
        outerAgentDefaultProvider: "fake"
      });
      createTask(context, { id: "task-daemon-scope-a", projectId: project.id, title: "scope a" });
      createTask(context, { id: "task-daemon-scope-b", projectId: project.id, title: "scope b" });
    });

    const result = withDatabase(databasePath, (context) =>
      runDaemonTick(context, {
        taskId: "task-daemon-scope-b",
        provider: new FakeAgentProvider("只输出建议，不请求工具。"),
        candidateLimit: 10
      })
    );

    expect(result.actions).toEqual([
      expect.objectContaining({
        kind: "agent_tool_skipped",
        taskId: "task-daemon-scope-b"
      })
    ]);
  });

  it("daemon operation replay 不会被已处理 daemon operation 挤出候选窗口", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);

    withDatabase(databasePath, (context) => {
      for (let index = 0; index < 3; index += 1) {
        const operation = createOperation(context, {
          idempotencyKey: `daemon:test:already-handled:${index}`,
          kind: "daemon:test",
          projectId: fixture.projectId,
          taskId: fixture.taskId
        });
        updateOperation(context, {
          operationId: operation.id,
          status: "unknown",
          lastObservedState: {
            decision: "unknown",
            reasonCode: "already-handled",
            observedSummary: "already handled"
          }
        });
      }
      const daemonOperation = createOperation(context, {
        idempotencyKey: "daemon:test:replay:not-starved-by-handled",
        kind: "daemon:test",
        projectId: fixture.projectId,
        taskId: fixture.taskId
      });
      updateOperation(context, {
        operationId: daemonOperation.id,
        status: "running",
        lastObservedState: { observedExternalState: "matches-intent" }
      });
    });

    withDatabase(databasePath, (context) =>
      runDaemonTick(context, {
        provider: new FakeAgentProvider("no-op"),
        candidateLimit: 1
      })
    );

    const state = withDatabase(databasePath, (context) => ({
      operation: getOperationByIdempotencyKey(context, "daemon:test:replay:not-starved-by-handled"),
      events: listTaskEvents(context, fixture.taskId)
    }));
    expect(state.operation).toMatchObject({ status: "reconciled" });
    expect(
      state.events.filter(
        (event) =>
          event.type === "daemon.recovery_decision" &&
          (event.payload as { reasonCode?: string } | undefined)?.reasonCode === "operation-matches-intent"
      )
    ).toHaveLength(1);
  });

  it("daemon operation replay 对 paused task 只写 safe inspect，不安排 retry", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);

    withDatabase(databasePath, (context) => {
      context.db.prepare("UPDATE tasks SET status = ?, state_version = state_version + 1 WHERE id = ?").run("paused", fixture.taskId);
      const operation = createOperation(context, {
        idempotencyKey: "daemon:test:replay:paused",
        kind: "daemon:test",
        projectId: fixture.projectId,
        taskId: fixture.taskId
      });
      updateOperation(context, {
        operationId: operation.id,
        status: "running",
        lastObservedState: { observedExternalState: "absent" }
      });
    });

    withDatabase(databasePath, (context) => runDaemonTick(context, { provider: new FakeAgentProvider("no-op") }));

    const state = withDatabase(databasePath, (context) => ({
      task: context.db.prepare("SELECT status FROM tasks WHERE id = ?").get(fixture.taskId) as { status: string },
      operation: getOperationByIdempotencyKey(context, "daemon:test:replay:paused"),
      events: listTaskEvents(context, fixture.taskId)
    }));
    expect(state.task.status).toBe("paused");
    expect(state.operation).toMatchObject({ status: "unknown" });
    expect(state.events.map((event) => event.type)).not.toContain("daemon.retry_scheduled");
    expect(state.events.find((event) => event.type === "daemon.recovery_decision")?.payload).toMatchObject({
      decision: "safe_inspect_only",
      reasonCode: "operation-replay-paused-safe-inspect"
    });
  });

  it("unknown daemon workflow inspect operation 会先执行 read-only inspect 再 reconcile", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const workspacePath = mkdtempSync(join(tmpdir(), "coordinator-daemon-workspace-"));
    const repoPath = join(workspacePath, "repo");
    mkdirSync(join(repoPath, ".git"), { recursive: true });
    const calls: string[][] = [];
    const runner: WorkflowProtocolRunner = (args) => {
      calls.push(args);
      return JSON.stringify({
        runId: "inner-run",
        profile: "feature",
        lifecycle: "active",
        handoff: { available: false, artifacts: [], deniedActions: [] },
        summary: "read-only inspected"
      });
    };

    withDatabase(databasePath, (context) => {
      const { attempt, branch } = createWorkflowWorkspaceFixture(context, fixture, "workflow-run-daemon");
      context.db
        .prepare(
          `INSERT INTO workflow_runs (id, project_id, task_id, attempt_id, profile_id, status, external_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("workflow-run-unknown-op", fixture.projectId, fixture.taskId, attempt.id, "feature", "running", "inner-run");
      const operation = createOperation(context, {
        idempotencyKey: "daemon:workflow:inspect:unknown-replay",
        kind: "daemon:workflow:inspect",
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        attemptId: attempt.id
      });
      updateOperation(context, {
        operationId: operation.id,
        status: "unknown",
        lastObservedState: { workflowRunId: "workflow-run-unknown-op", observedExternalState: "unclear" }
      });
    });

    withDatabase(databasePath, (context) => runDaemonTick(context, { workflowInspectRunner: runner }));
    withDatabase(databasePath, (context) => runDaemonTick(context, { workflowInspectRunner: runner }));

    const state = withDatabase(databasePath, (context) => ({
      operation: getOperationByIdempotencyKey(context, "daemon:workflow:inspect:unknown-replay"),
      events: listTaskEvents(context, fixture.taskId)
    }));
    expect(calls.map((args) => args.join(" "))).toContain("protocol status --run inner-run");
    expect(state.operation).toMatchObject({ status: "reconciled" });
    expect(
      state.events.filter(
        (event) =>
          event.type === "daemon.recovery_decision" &&
          (event.payload as { reasonCode?: string } | undefined)?.reasonCode === "unknown-operation-external-matches"
      )
    ).toHaveLength(1);
  });

  it("unknown workflow action operation 通过 protocol inspect 对账后封口为 reconciled", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const calls: string[][] = [];
    let branch = "";
    const runner: WorkflowProtocolRunner = (args) => {
      calls.push(args);
      return JSON.stringify({
        runId: "inner-action-run",
        profile: "feature",
        lifecycle: "active",
        handoff: { available: false, artifacts: [], deniedActions: [] },
        summary: "action status inspected"
      });
    };

    withDatabase(databasePath, (context) => {
      const created = createWorkflowWorkspaceFixture(context, fixture, "workflow-action-reconcile");
      branch = created.branch;
      context.db
        .prepare(
          `INSERT INTO workflow_runs (id, project_id, task_id, attempt_id, profile_id, status, external_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("workflow-action-reconcile", fixture.projectId, fixture.taskId, created.attempt.id, "feature", "running", "inner-action-run");
      const operation = createOperation(context, {
        idempotencyKey: "workflow:action:workflow-action-reconcile:1:run-alignment-checks",
        kind: "workflow:action",
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        attemptId: created.attempt.id,
        externalId: "inner-action-run"
      });
      updateOperation(context, {
        operationId: operation.id,
        status: "unknown",
        lastObservedState: { phase: "workflow-action-failed", workflowRunId: "workflow-action-reconcile", action: "run-alignment-checks" }
      });
    });

    withDatabase(databasePath, (context) => runDaemonTick(context, {
      workflowInspectRunner: runner,
      workspaceGitRunner: createWorkflowWorkspaceGitRunner(branch)
    }));

    const state = withDatabase(databasePath, (context) => ({
      operation: getOperationByIdempotencyKey(context, "workflow:action:workflow-action-reconcile:1:run-alignment-checks"),
      run: context.db.prepare("SELECT status, state_version FROM workflow_runs WHERE id = ?").get("workflow-action-reconcile") as {
        status: string;
        state_version: number;
      },
      events: listTaskEvents(context, fixture.taskId)
    }));
    expect(calls.map((args) => args.join(" "))).toEqual(["protocol status --run inner-action-run"]);
    expect(state.operation).toMatchObject({ status: "reconciled" });
    expect(state.run).toMatchObject({ status: "running", state_version: 1 });
    expect(
      state.events.find(
        (event) =>
          event.type === "daemon.recovery_decision" &&
          (event.payload as { reasonCode?: string } | undefined)?.reasonCode === "unknown-operation-external-matches"
      )?.payload
    ).toMatchObject({
      decision: "reconciled",
      resourceKind: "operation"
    });
    expect(state.events.filter((event) => event.type === "daemon.workflow_reconciled")).toHaveLength(0);
  });

  it("真实 invokeWorkflowAction 失败记录 workflowRunId，并可由 daemon 对账封口", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const calls: string[][] = [];
    let branch = "";
    let actionKey = "";
    const failingActionRunner: WorkflowProtocolRunner = (args) => {
      calls.push(args);
      if (args[1] === "action") {
        throw new Error("openspec validate failed");
      }
      return JSON.stringify({
        runId: "inner-action-run",
        profile: "feature",
        lifecycle: "active",
        handoff: { available: false, artifacts: [], deniedActions: [] },
        summary: "status after failed action"
      });
    };

    withDatabase(databasePath, (context) => {
      const created = createWorkflowWorkspaceFixture(context, fixture, "workflow-action-real-failure");
      branch = created.branch;
      context.db
        .prepare(
          `INSERT INTO workflow_runs (id, project_id, task_id, attempt_id, profile_id, status, external_id, state_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run("workflow-action-real-failure", fixture.projectId, fixture.taskId, created.attempt.id, "feature", "running", "inner-action-run", 1);
      expect(() =>
        invokeWorkflowAction(context, {
          workflowRunId: "workflow-action-real-failure",
          action: "run-alignment-checks",
          expectedStateVersion: 1,
          runner: failingActionRunner
        })
      ).toThrow(/openspec validate failed/);
      const row = context.db
        .prepare("SELECT idempotency_key FROM operations WHERE kind = ? AND attempt_id = ?")
        .get("workflow:action", created.attempt.id) as { idempotency_key: string };
      actionKey = row.idempotency_key;
    });

    const afterFailure = withDatabase(databasePath, (context) => getOperationByIdempotencyKey(context, actionKey));
    expect(afterFailure).toMatchObject({
      status: "unknown",
      lastObservedState: expect.objectContaining({ workflowRunId: "workflow-action-real-failure" })
    });

    withDatabase(databasePath, (context) => runDaemonTick(context, {
      workflowInspectRunner: failingActionRunner,
      workspaceGitRunner: createWorkflowWorkspaceGitRunner(branch)
    }));

    const state = withDatabase(databasePath, (context) => ({
      operation: getOperationByIdempotencyKey(context, actionKey),
      run: context.db.prepare("SELECT status, state_version FROM workflow_runs WHERE id = ?").get("workflow-action-real-failure") as {
        status: string;
        state_version: number;
      }
    }));
    expect(calls.map((args) => args.join(" "))).toEqual([
      "protocol action --run inner-action-run run-alignment-checks",
      "protocol status --run inner-action-run"
    ]);
    expect(state.operation).toMatchObject({ status: "reconciled" });
    expect(state.run).toMatchObject({ status: "running", state_version: 2 });

    const replayRunner: WorkflowProtocolRunner = (args) =>
      JSON.stringify({
        runId: "inner-action-run",
        profile: "feature",
        lifecycle: "active",
        handoff: { available: false, artifacts: [], deniedActions: [] },
        summary: args[1] === "action" ? "new action applied" : "old version replay inspected"
      });
    const replay = withDatabase(databasePath, (context) => {
      const oldVersion = invokeWorkflowAction(context, {
        workflowRunId: "workflow-action-real-failure",
        action: "run-alignment-checks",
        expectedStateVersion: 1,
        runner: replayRunner
      });
      const newVersion = invokeWorkflowAction(context, {
        workflowRunId: "workflow-action-real-failure",
        action: "run-alignment-checks",
        expectedStateVersion: 2,
        runner: replayRunner
      });
      return { oldVersion, newVersion };
    });
    expect(replay.oldVersion.reused).toBe(true);
    expect(replay.oldVersion.operationId).toBe(state.operation?.id);
    expect(replay.newVersion.reused).toBe(false);
  });

  it("同一 workflow run 多个 action operation 在同一 tick 只 inspect 一次", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const calls: string[][] = [];
    let branch = "";
    const runner: WorkflowProtocolRunner = (args) => {
      calls.push(args);
      return JSON.stringify({
        runId: "inner-action-run",
        profile: "feature",
        lifecycle: "active",
        handoff: { available: false, artifacts: [], deniedActions: [] },
        summary: "single status observation"
      });
    };

    withDatabase(databasePath, (context) => {
      const created = createWorkflowWorkspaceFixture(context, fixture, "workflow-action-dedupe");
      branch = created.branch;
      context.db
        .prepare(
          `INSERT INTO workflow_runs (id, project_id, task_id, attempt_id, profile_id, status, external_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("workflow-action-dedupe", fixture.projectId, fixture.taskId, created.attempt.id, "feature", "running", "inner-action-run");
      for (const action of ["run-alignment-checks", "freeze-requirements"]) {
        const operation = createOperation(context, {
          idempotencyKey: `workflow:action:workflow-action-dedupe:1:${action}`,
          kind: "workflow:action",
          projectId: fixture.projectId,
          taskId: fixture.taskId,
          attemptId: created.attempt.id,
          externalId: "inner-action-run"
        });
        updateOperation(context, {
          operationId: operation.id,
          status: "unknown",
          lastObservedState: { workflowRunId: "workflow-action-dedupe", action }
        });
      }
    });

    withDatabase(databasePath, (context) => runDaemonTick(context, {
      workflowInspectRunner: runner,
      workspaceGitRunner: createWorkflowWorkspaceGitRunner(branch)
    }));

    const state = withDatabase(databasePath, (context) => ({
      first: getOperationByIdempotencyKey(context, "workflow:action:workflow-action-dedupe:1:run-alignment-checks"),
      second: getOperationByIdempotencyKey(context, "workflow:action:workflow-action-dedupe:1:freeze-requirements"),
      run: context.db.prepare("SELECT state_version FROM workflow_runs WHERE id = ?").get("workflow-action-dedupe") as { state_version: number }
    }));
    expect(calls.map((args) => args.join(" "))).toEqual(["protocol status --run inner-action-run"]);
    expect(state.first).toMatchObject({ status: "reconciled" });
    expect(state.second).toMatchObject({ status: "reconciled" });
    expect(state.run.state_version).toBe(1);
  });

  it("workflow action operation inspect 失败时保持 unknown 且不推进 completed", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const runner: WorkflowProtocolRunner = () => {
      throw new Error("workflow action inspect unavailable secret-provider-output lockToken completeOperationJson");
    };
    let branch = "";

    withDatabase(databasePath, (context) => {
      const created = createWorkflowWorkspaceFixture(context, fixture, "workflow-action-inspect-failed");
      branch = created.branch;
      context.db
        .prepare(
          `INSERT INTO workflow_runs (id, project_id, task_id, attempt_id, profile_id, status, external_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("workflow-action-inspect-failed", fixture.projectId, fixture.taskId, created.attempt.id, "feature", "running", "inner-action-run");
      const operation = createOperation(context, {
        idempotencyKey: "workflow:action:workflow-action-inspect-failed:1:run-alignment-checks",
        kind: "workflow:action",
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        attemptId: created.attempt.id,
        externalId: "inner-action-run"
      });
      updateOperation(context, {
        operationId: operation.id,
        status: "unknown",
        lastObservedState: { phase: "workflow-action-failed", workflowRunId: "workflow-action-inspect-failed", action: "run-alignment-checks" }
      });
    });

    const result = withDatabase(databasePath, (context) => runDaemonTick(context, {
      workflowInspectRunner: runner,
      workspaceGitRunner: createWorkflowWorkspaceGitRunner(branch)
    }));

    const state = withDatabase(databasePath, (context) => ({
      operation: getOperationByIdempotencyKey(context, "workflow:action:workflow-action-inspect-failed:1:run-alignment-checks"),
      run: context.db.prepare("SELECT status, handoff_kind FROM workflow_runs WHERE id = ?").get("workflow-action-inspect-failed") as {
        status: string;
        handoff_kind: string | null;
      },
      events: listTaskEvents(context, fixture.taskId)
    }));
    expect(result.actions).toContainEqual(expect.objectContaining({
      kind: "reconcile_failed",
      workflowRunId: "workflow-action-inspect-failed",
      status: "failed"
    }));
    expect(state.operation).toMatchObject({ status: "unknown" });
    expect(state.run).toMatchObject({ status: "running", handoff_kind: null });
    expect(JSON.stringify(state.events)).not.toContain("secret-provider-output");
    expect(JSON.stringify(state.events)).not.toContain("lockToken");
    expect(JSON.stringify(state.events)).not.toContain("completeOperationJson");
    expect(
      state.events.find(
        (event) =>
          event.type === "daemon.recovery_decision" &&
          (event.payload as { reasonCode?: string } | undefined)?.reasonCode === "operation-inspect-failed"
      )?.payload
    ).toMatchObject({
      decision: "operator_attention",
      observedSummary: "operation inspect failed"
    });
  });

  it("workflow action recovery 只调用 protocol status，不读取 .workflow private state", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const calls: string[][] = [];
    let branch = "";
    const runner: WorkflowProtocolRunner = (args) => {
      calls.push(args);
      return JSON.stringify({
        runId: "inner-action-run",
        profile: "feature",
        lifecycle: "active",
        handoff: { available: false, artifacts: [], deniedActions: [] },
        summary: "status from protocol"
      });
    };

    withDatabase(databasePath, (context) => {
      const { attempt, workspace, branch: createdBranch } = createWorkflowWorkspaceFixture(context, fixture, "workflow-action-private-state");
      branch = createdBranch;
      const repoPath = workspace.repoPath;
      expect(repoPath).toBeDefined();
      mkdirSync(join(repoPath!, ".workflow", "runs", "inner-action-run"), { recursive: true });
      writeFileSync(
        join(repoPath!, ".workflow", "runs", "inner-action-run", "state.json"),
        JSON.stringify({
          runId: "inner-action-run",
          profile: "feature",
          lifecycle: "completed",
          handoff: { available: true, kind: "pr_ready" }
        })
      );
      context.db
        .prepare(
          `INSERT INTO workflow_runs (id, project_id, task_id, attempt_id, profile_id, status, external_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("workflow-action-private-state", fixture.projectId, fixture.taskId, attempt.id, "feature", "running", "inner-action-run");
      const operation = createOperation(context, {
        idempotencyKey: "workflow:action:workflow-action-private-state:1:run-alignment-checks",
        kind: "workflow:action",
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        attemptId: attempt.id,
        externalId: "inner-action-run"
      });
      updateOperation(context, {
        operationId: operation.id,
        status: "unknown",
        lastObservedState: { workflowRunId: "workflow-action-private-state", action: "run-alignment-checks" }
      });
    });

    withDatabase(databasePath, (context) => runDaemonTick(context, {
      workflowInspectRunner: runner,
      workspaceGitRunner: createWorkflowWorkspaceGitRunner(branch)
    }));

    const state = withDatabase(databasePath, (context) => ({
      run: context.db.prepare("SELECT status, handoff_kind FROM workflow_runs WHERE id = ?").get("workflow-action-private-state") as {
        status: string;
        handoff_kind: string | null;
      },
      operation: getOperationByIdempotencyKey(context, "workflow:action:workflow-action-private-state:1:run-alignment-checks")
    }));
    expect(calls.map((args) => args.join(" "))).toEqual(["protocol status --run inner-action-run"]);
    expect(state.run).toMatchObject({ status: "running", handoff_kind: null });
    expect(state.operation).toMatchObject({ status: "reconciled" });
  });

  it("unknown daemon workflow inspect 失败时写 recovery decision 并封口，避免 tick 中断和重复撞错", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const runner: WorkflowProtocolRunner = () => {
      throw new Error("workflow inspect still unavailable secret-provider-output lockToken completeOperationJson");
    };

    withDatabase(databasePath, (context) => {
      const operation = createOperation(context, {
        idempotencyKey: "daemon:workflow:inspect:failed-replay",
        kind: "daemon:workflow:inspect",
        projectId: fixture.projectId,
        taskId: fixture.taskId
      });
      updateOperation(context, {
        operationId: operation.id,
        status: "unknown",
        lastObservedState: { workflowRunId: "missing-workflow-run", observedExternalState: "unclear" }
      });
    });

    const first = withDatabase(databasePath, (context) => runDaemonTick(context, { workflowInspectRunner: runner }));
    const second = withDatabase(databasePath, (context) => runDaemonTick(context, { workflowInspectRunner: runner }));

    const state = withDatabase(databasePath, (context) => ({
      operation: getOperationByIdempotencyKey(context, "daemon:workflow:inspect:failed-replay"),
      events: listTaskEvents(context, fixture.taskId)
    }));
    expect(first.status).toBe("failed");
    expect(second.actions.some((action) => action.summary.includes("workflow inspect still unavailable"))).toBe(false);
    expect(state.operation).toMatchObject({ status: "unknown" });
    expect(JSON.stringify(state.events)).not.toContain("secret-provider-output");
    expect(JSON.stringify(state.events)).not.toContain("lockToken");
    expect(JSON.stringify(state.events)).not.toContain("completeOperationJson");
    expect(
      state.events.filter(
        (event) =>
          event.type === "daemon.recovery_decision" &&
          (event.payload as { reasonCode?: string } | undefined)?.reasonCode === "operation-inspect-failed"
      )
    ).toHaveLength(1);
    expect(state.events.find((event) => event.type === "daemon.recovery_decision")?.payload).toMatchObject({
      observedSummary: "operation inspect failed: WorkflowProtocolError",
      artifactRefs: []
    });
  });

  it("daemon workflow inspect operation replay 后同一 tick 不再重复 reconcile 同一 workflow run", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const workspacePath = mkdtempSync(join(tmpdir(), "coordinator-daemon-workspace-"));
    const repoPath = join(workspacePath, "repo");
    mkdirSync(join(repoPath, ".git"), { recursive: true });
    let inspectCount = 0;
    const runner: WorkflowProtocolRunner = () => {
      inspectCount += 1;
      return JSON.stringify({
        runId: "inner-run",
        profile: "feature",
        lifecycle: "active",
        handoff: { available: false, artifacts: [], deniedActions: [] },
        summary: "running"
      });
    };

    withDatabase(databasePath, (context) => {
      createExecutionPlan(context, {
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        status: "active",
        artifactPath: "execution-plan.md"
      });
      const attempt = createAttempt(context, { projectId: fixture.projectId, taskId: fixture.taskId });
      createWorkspace(context, {
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        attemptId: attempt.id,
        status: "ready",
        workspacePath,
        repoPath,
        branch: `coordinator/${fixture.taskId}/${attempt.id}`,
        baseBranch: "main"
      });
      context.db
        .prepare(
          `INSERT INTO workflow_runs (id, project_id, task_id, attempt_id, profile_id, status, external_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("workflow-run-replay-skip", fixture.projectId, fixture.taskId, attempt.id, "feature", "running", "inner-run");
      const operation = createOperation(context, {
        idempotencyKey: "daemon:workflow:inspect:replay-skip",
        kind: "daemon:workflow:inspect",
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        attemptId: attempt.id
      });
      updateOperation(context, {
        operationId: operation.id,
        status: "unknown",
        lastObservedState: { workflowRunId: "workflow-run-replay-skip", observedExternalState: "unclear" }
      });
    });

    withDatabase(databasePath, (context) => runDaemonTick(context, { workflowInspectRunner: runner }));

    const state = withDatabase(databasePath, (context) => ({
      events: listTaskEvents(context, fixture.taskId),
      operation: getOperationByIdempotencyKey(context, "daemon:workflow:inspect:replay-skip")
    }));
    expect(inspectCount).toBe(1);
    expect(state.operation).toMatchObject({ status: "reconciled" });
    expect(state.events.filter((event) => event.type === "daemon.workflow_reconciled")).toHaveLength(0);
    expect(
      state.events.filter(
        (event) =>
          event.type === "daemon.recovery_decision" &&
          (event.payload as { reasonCode?: string } | undefined)?.reasonCode === "unknown-operation-external-matches"
      )
    ).toHaveLength(1);
  });

  it("daemon operation replay retry budget 耗尽时进入 operator attention，不把 operation 误标 reconciled", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);

    withDatabase(databasePath, (context) => {
      for (let index = 0; index < 5; index += 1) {
        appendEvent(context, {
          type: "daemon.retry_scheduled",
          summary: `previous retry ${index}`,
          projectId: fixture.projectId,
          taskId: fixture.taskId
        });
      }
      const operation = createOperation(context, {
        idempotencyKey: "daemon:test:replay:retry-exhausted",
        kind: "daemon:test",
        projectId: fixture.projectId,
        taskId: fixture.taskId
      });
      updateOperation(context, {
        operationId: operation.id,
        status: "running",
        lastObservedState: { observedExternalState: "absent" }
      });
    });

    withDatabase(databasePath, (context) => runDaemonTick(context, { provider: new FakeAgentProvider("no-op") }));

    const state = withDatabase(databasePath, (context) => ({
      task: context.db.prepare("SELECT status FROM tasks WHERE id = ?").get(fixture.taskId) as { status: string },
      operation: getOperationByIdempotencyKey(context, "daemon:test:replay:retry-exhausted"),
      events: listTaskEvents(context, fixture.taskId)
    }));
    expect(state.task.status).not.toBe("resuming");
    expect(state.operation).toMatchObject({ status: "unknown" });
    expect(state.events.find((event) => event.type === "daemon.recovery_decision")?.payload).toMatchObject({
      decision: "operator_attention",
      reasonCode: "operation-absent-retry-exhausted"
    });
  });

  it("workflow reconcile 只通过 workflow protocol，不因外部不可用而推进 completed", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const runner: WorkflowProtocolRunner = () => {
      throw new Error("workflow unavailable secret-provider-output lockToken completeOperationJson");
    };
    let branch = "";

    withDatabase(databasePath, (context) => {
      const fixtureWorkspace = createWorkflowWorkspaceFixture(context, fixture, "workflow-run-daemon");
      branch = fixtureWorkspace.branch;
      context.db
        .prepare(
          `INSERT INTO workflow_runs (id, project_id, task_id, attempt_id, profile_id, status, external_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("workflow-run-daemon", fixture.projectId, fixture.taskId, fixtureWorkspace.attempt.id, "feature", "running", "inner-run");
    });

    const result = withDatabase(databasePath, (context) => runDaemonTick(context, {
      workflowInspectRunner: runner,
      workspaceGitRunner: createWorkflowWorkspaceGitRunner(branch)
    }));
    expect(result.actions).toContainEqual(
      expect.objectContaining({
        kind: "reconcile_failed",
        workflowRunId: "workflow-run-daemon",
        status: "failed"
      })
    );
    const surface = withDatabase(databasePath, (context) => buildTaskSurfaceFromDb(context, fixture.taskId));
    expect(surface.json.workflow_runs[0]).toMatchObject({ id: "workflow-run-daemon", status: "running" });
    const events = withDatabase(databasePath, (context) => listTaskEvents(context, fixture.taskId));
    const operation = withDatabase(databasePath, (context) =>
      context.db.prepare("SELECT last_observed_state FROM operations WHERE kind = ?").get("daemon:workflow:inspect")
    ) as { last_observed_state: string };
    const recovery = events.find(
      (event) =>
        event.type === "daemon.recovery_decision" &&
        (event.payload as { reasonCode?: string } | undefined)?.reasonCode === "workflow-protocol-unavailable"
    );
    expect(recovery?.payload).toMatchObject({
      reasonCode: "workflow-protocol-unavailable",
      decision: "unknown"
    });
    expect(events.find((event) => event.type === "daemon.workflow_reconcile_failed")?.payload).toMatchObject({
      error: "Error"
    });
    expect(JSON.stringify(events)).not.toContain("secret-provider-output");
    expect(JSON.stringify(events)).not.toContain("lockToken");
    expect(JSON.stringify(events)).not.toContain("completeOperationJson");
    expect(operation.last_observed_state).not.toContain("secret-provider-output");
  });

  it("daemon inspect 到 agent/internal workflow action 时不制造 operator blocker", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const runner: WorkflowProtocolRunner = () =>
      JSON.stringify({
        runId: "inner-run-internal-action",
        profile: "feature",
        lifecycle: "active",
        allowedActions: ["materialize-change"],
        actionInputs: {
          "materialize-change": {
            requiredArgs: ["change-id"],
            usage: "workflow protocol action --run inner-run-internal-action materialize-change <change-id>"
          }
        },
        handoff: { available: false, artifacts: [] },
        summary: "implementation continues in workflow runtime"
      });
    let branch = "";

    withDatabase(databasePath, (context) => {
      const fixtureWorkspace = createWorkflowWorkspaceFixture(context, fixture, "workflow-run-internal-action");
      branch = fixtureWorkspace.branch;
      context.db
        .prepare(
          `INSERT INTO workflow_runs (id, project_id, task_id, attempt_id, profile_id, status, external_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "workflow-run-internal-action",
          fixture.projectId,
          fixture.taskId,
          fixtureWorkspace.attempt.id,
          "feature",
          "running",
          "inner-run-internal-action"
        );
      context.db.prepare("UPDATE tasks SET status = ? WHERE id = ?").run("running", fixture.taskId);
    });

    const result = withDatabase(databasePath, (context) =>
      runDaemonTick(context, {
        taskId: fixture.taskId,
        workflowInspectRunner: runner,
        workspaceGitRunner: createWorkflowWorkspaceGitRunner(branch)
      })
    );
    expect(result.actions).toContainEqual(
      expect.objectContaining({
        kind: "workflow_inspected",
        workflowRunId: "workflow-run-internal-action",
        status: "succeeded"
      })
    );

    const state = withDatabase(databasePath, (context) => ({
      task: context.db.prepare("SELECT status FROM tasks WHERE id = ?").get(fixture.taskId) as { status: string },
      events: listTaskEvents(context, fixture.taskId),
      surface: buildTaskSurfaceFromDb(context, fixture.taskId)
    }));
    expect(state.task.status).toBe("running");
    expect(state.events.map((event) => event.type)).not.toContain("human.request_created");
    expect(JSON.stringify(state.events)).not.toContain("operator_attention");
    expect(JSON.stringify(state.surface.json.available_tools)).not.toContain("workflow_action");
  });

  it("task-scoped workflow inspect 先按 task 过滤再 LIMIT", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const runner: WorkflowProtocolRunner = () =>
      JSON.stringify({
        runId: "inner-target-scope",
        profile: "feature",
        lifecycle: "active",
        summary: "scoped workflow inspected",
        handoff: { available: false, artifacts: [] }
      });
    let targetBranch = "";

    withDatabase(databasePath, (context) => {
      for (let index = 0; index < 6; index += 1) {
        createTask(context, {
          id: `task-daemon-other-${index}`,
          projectId: fixture.projectId,
          title: `other ${index}`
        });
        const otherWorkspace = createWorkflowWorkspaceFixture(
          context,
          { ...fixture, taskId: `task-daemon-other-${index}` },
          `workflow-run-other-${index}`
        );
        context.db
          .prepare(
            `INSERT INTO workflow_runs (id, project_id, task_id, attempt_id, profile_id, status, external_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            `workflow-run-other-${index}`,
            fixture.projectId,
            `task-daemon-other-${index}`,
            otherWorkspace.attempt.id,
            "feature",
            "running",
            `inner-other-${index}`,
            `2026-05-01T00:00:0${index}.000Z`,
            `2026-05-01T00:00:0${index}.000Z`
          );
      }
      const targetWorkspace = createWorkflowWorkspaceFixture(context, fixture, "workflow-run-target-scope");
      targetBranch = targetWorkspace.branch;
      context.db
        .prepare(
          `INSERT INTO workflow_runs (id, project_id, task_id, attempt_id, profile_id, status, external_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "workflow-run-target-scope",
          fixture.projectId,
          fixture.taskId,
          targetWorkspace.attempt.id,
          "feature",
          "running",
          "inner-target-scope",
          "2026-05-01T00:01:00.000Z",
          "2026-05-01T00:01:00.000Z"
        );
    });

    const result = withDatabase(databasePath, (context) =>
      runDaemonTick(context, {
        taskId: fixture.taskId,
        candidateLimit: 1,
        workflowInspectRunner: runner,
        workspaceGitRunner: createWorkflowWorkspaceGitRunner(targetBranch)
      })
    );

    expect(result.actions).toContainEqual(
      expect.objectContaining({
        kind: "workflow_inspected",
        taskId: fixture.taskId,
        workflowRunId: "workflow-run-target-scope"
      })
    );
  });

  it("workflow runId mismatch 进入 recovery decision，不推进 completed 或 pr_ready", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    let branch = "";
    const runner: WorkflowProtocolRunner = () =>
      JSON.stringify({
        runId: "wrong-inner-run",
        profile: "feature",
        lifecycle: "active",
        handoff: { available: false, artifacts: [], deniedActions: [] },
        summary: "wrong run"
      });

    withDatabase(databasePath, (context) => {
      const fixtureWorkspace = createWorkflowWorkspaceFixture(context, fixture, "workflow-run-mismatch");
      branch = fixtureWorkspace.branch;
      context.db
        .prepare(
          `INSERT INTO workflow_runs (id, project_id, task_id, attempt_id, profile_id, status, external_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("workflow-run-mismatch", fixture.projectId, fixture.taskId, fixtureWorkspace.attempt.id, "feature", "running", "inner-run");
    });

    withDatabase(databasePath, (context) => runDaemonTick(context, {
      workflowInspectRunner: runner,
      workspaceGitRunner: createWorkflowWorkspaceGitRunner(branch)
    }));

    const surface = withDatabase(databasePath, (context) => buildTaskSurfaceFromDb(context, fixture.taskId));
    expect(surface.json.workflow_runs[0]).toMatchObject({ id: "workflow-run-mismatch", status: "running" });
    const events = withDatabase(databasePath, (context) => listTaskEvents(context, fixture.taskId));
    const recovery = events.find(
      (event) =>
        event.type === "daemon.recovery_decision" &&
        (event.payload as { reasonCode?: string } | undefined)?.reasonCode === "workflow-run-id-mismatch"
    );
    expect(recovery?.payload).toMatchObject({
      reasonCode: "workflow-run-id-mismatch",
      decision: "operator_attention",
      operatorAttentionRequired: true
    });
  });

  it("workflow profile mismatch 进入 recovery decision，不推进 completed 或 pr_ready", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    let branch = "";
    const runner: WorkflowProtocolRunner = () =>
      JSON.stringify({
        runId: "inner-run",
        profile: "bugfix",
        lifecycle: "completed",
        handoff: { available: true, kind: "pr_ready", artifacts: [], deniedActions: [] },
        summary: "wrong profile"
      });

    withDatabase(databasePath, (context) => {
      const fixtureWorkspace = createWorkflowWorkspaceFixture(context, fixture, "workflow-run-profile-mismatch");
      branch = fixtureWorkspace.branch;
      context.db
        .prepare(
          `INSERT INTO workflow_runs (id, project_id, task_id, attempt_id, profile_id, status, external_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("workflow-run-profile-mismatch", fixture.projectId, fixture.taskId, fixtureWorkspace.attempt.id, "feature", "running", "inner-run");
    });

    withDatabase(databasePath, (context) => runDaemonTick(context, {
      workflowInspectRunner: runner,
      workspaceGitRunner: createWorkflowWorkspaceGitRunner(branch)
    }));

    const surface = withDatabase(databasePath, (context) => buildTaskSurfaceFromDb(context, fixture.taskId));
    expect(surface.json.workflow_runs[0]).toMatchObject({ id: "workflow-run-profile-mismatch", status: "running" });
    const events = withDatabase(databasePath, (context) => listTaskEvents(context, fixture.taskId));
    const recovery = events.find(
      (event) =>
        event.type === "daemon.recovery_decision" &&
        (event.payload as { reasonCode?: string } | undefined)?.reasonCode === "workflow-profile-mismatch"
    );
    expect(recovery?.payload).toMatchObject({
      reasonCode: "workflow-profile-mismatch",
      decision: "operator_attention",
      operatorAttentionRequired: true
    });
  });

  it("human request answered 后 daemon 标记 consumed 并唤醒 agent", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const provider = new FakeAgentProvider("收到回答，先继续整理计划。");

    withDatabase(databasePath, (context) => {
      const request = createHumanRequest(context, {
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        blockedKey: "agent:requirements-clarification:task-daemon",
        kind: "requirements-clarification",
        status: "pending",
        questionArtifactPath: "human-question.md"
      });
      const task = context.db.prepare("SELECT state_version FROM tasks WHERE id = ?").get(fixture.taskId) as {
        state_version: number;
      };
      context.db.prepare("UPDATE tasks SET status = ?, state_version = state_version + 1 WHERE id = ?").run("waiting_human", fixture.taskId);
      expect(task.state_version).toBe(0);
      updateHumanRequest(context, {
        humanRequestId: request.id,
        expectedStateVersion: request.stateVersion,
        status: "answered",
        answerArtifactPath: "human-answer.md"
      });
    });

    const result = withDatabase(databasePath, (context) => runDaemonTick(context, { provider }));
    expect(result.actions.some((action) => action.kind === "human_wake_up" || action.kind === "agent_tool_skipped")).toBe(true);

    const surface = withDatabase(databasePath, (context) => buildTaskSurfaceFromDb(context, fixture.taskId));
    expect(surface.json.task.status).toBe("human_answered");
    expect(surface.json.human_requests[0]).toMatchObject({ status: "consumed" });
  });

  it("answered human request 不会唤醒 paused task", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);

    withDatabase(databasePath, (context) => {
      const request = createHumanRequest(context, {
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        blockedKey: "agent:requirements-clarification:paused",
        kind: "requirements-clarification",
        status: "answered",
        answerArtifactPath: "human-answer.md"
      });
      expect(request.status).toBe("answered");
      context.db.prepare("UPDATE tasks SET status = ?, state_version = state_version + 1 WHERE id = ?").run("paused", fixture.taskId);
    });

    const result = withDatabase(databasePath, (context) =>
      runDaemonTick(context, {
        provider: {
          id: "must-not-run-paused-human",
          kind: "fake",
          capabilities: ["test"],
          run(_input: AgentProviderRunInput) {
            throw new Error("provider should not run for paused human wake-up");
          }
        }
      })
    );

    expect(result.actions).toContainEqual(
      expect.objectContaining({
        kind: "retry_blocked",
        humanRequestId: expect.any(String),
        status: "skipped",
        summary: expect.stringContaining("task is paused")
      })
    );
    const surface = withDatabase(databasePath, (context) => buildTaskSurfaceFromDb(context, fixture.taskId));
    expect(surface.json.task.status).toBe("paused");
    expect(surface.json.human_requests[0]).toMatchObject({ status: "answered" });
  });

  it("retry budget 耗尽时 daemon 不继续启动 agent", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    withDatabase(databasePath, (context) => {
      appendEvent(context, {
        type: "daemon.advance_failed",
        summary: "previous failure",
        projectId: fixture.projectId,
        taskId: fixture.taskId
      });
    });

    const result = withDatabase(databasePath, (context) =>
      runDaemonTick(context, {
        retryBudget: 1,
        provider: {
          id: "should-not-run",
          kind: "fake",
          capabilities: ["test"],
          run(_input: AgentProviderRunInput) {
            throw new Error("provider should not run");
          }
        }
      })
    );

    expect(result.actions).toContainEqual(
      expect.objectContaining({
        kind: "retry_blocked",
        taskId: fixture.taskId,
        status: "skipped"
      })
    );
  });

  it("stale outer session 会被停止并安排 retry，避免永久阻塞 retry_due", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const now = new Date("2026-05-04T00:00:00.000Z");
    withDatabase(databasePath, (context) => {
      createAgentSession(context, {
        id: "stale-agent-session",
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        providerKind: "fake",
        role: "outer",
        status: "running"
      });
      context.db
        .prepare("UPDATE agent_sessions SET updated_at = ? WHERE id = ?")
        .run("2026-05-03T23:00:00.000Z", "stale-agent-session");
    });

    const result = withDatabase(databasePath, (context) => runDaemonTick(context, { now, provider: new FakeAgentProvider("no-op") }));

    expect(result.actions).toContainEqual(
      expect.objectContaining({
        kind: "reconcile_failed",
        agentSessionId: "stale-agent-session",
        status: "skipped"
      })
    );
    const state = withDatabase(databasePath, (context) =>
      context.db.prepare("SELECT status FROM agent_sessions WHERE id = ?").get("stale-agent-session")
    ) as { status: string };
    expect(state.status).toBe("stopped");
    const events = withDatabase(databasePath, (context) => listTaskEvents(context, fixture.taskId));
    expect(events.map((event) => event.type)).toContain("agent.session_inspected");
    expect(events.findIndex((event) => event.type === "agent.session_inspected")).toBeLessThan(
      events.findIndex((event) => event.type === "daemon.recovery_decision")
    );
  });

  it("stale outer session retry 耗尽时仍停止 session 并封口 operation，避免 active session 永久阻塞", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const now = new Date("2026-05-04T00:00:00.000Z");
    withDatabase(databasePath, (context) => {
      for (let index = 0; index < 5; index += 1) {
        appendEvent(context, {
          type: "daemon.retry_scheduled",
          summary: `previous retry ${index}`,
          projectId: fixture.projectId,
          taskId: fixture.taskId
        });
      }
      createAgentSession(context, {
        id: "stale-agent-session-exhausted",
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        providerKind: "fake",
        role: "outer",
        status: "running"
      });
      context.db
        .prepare("UPDATE agent_sessions SET updated_at = ? WHERE id = ?")
        .run("2026-05-03T23:00:00.000Z", "stale-agent-session-exhausted");
    });

    const first = withDatabase(databasePath, (context) => runDaemonTick(context, { now, provider: new FakeAgentProvider("no-op") }));
    const second = withDatabase(databasePath, (context) => runDaemonTick(context, { now, provider: new FakeAgentProvider("no-op") }));

    const state = withDatabase(databasePath, (context) => ({
      session: context.db.prepare("SELECT status FROM agent_sessions WHERE id = ?").get("stale-agent-session-exhausted") as { status: string },
      operation: getOperationByIdempotencyKey(context, "daemon:agent:stale:stale-agent-session-exhausted"),
      events: listTaskEvents(context, fixture.taskId)
    }));
    expect(first.actions).toContainEqual(expect.objectContaining({ agentSessionId: "stale-agent-session-exhausted", status: "failed" }));
    expect(second.actions.some((action) => action.agentSessionId === "stale-agent-session-exhausted")).toBe(false);
    expect(state.session.status).toBe("stopped");
    expect(state.operation).toMatchObject({ status: "unknown" });
    expect(state.operation?.lastObservedState).toMatchObject({
      decision: "operator_attention",
      reasonCode: "agent-session-retry-exhausted"
    });
  });

  it("retry_due 未到期不启动 provider，到期后可启动 provider", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const scheduledAt = new Date("2026-05-04T00:00:00.000Z");
    withDatabase(databasePath, (context) => {
      appendEvent(context, {
        type: "daemon.retry_scheduled",
        summary: "scheduled retry",
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        payload: { dueAt: "2026-05-04T00:00:10.000Z", attempt: 1, delayMs: 10_000 }
      });
      context.db.prepare("UPDATE tasks SET status = ?, state_version = state_version + 1 WHERE id = ?").run("resuming", fixture.taskId);
    });

    const early = withDatabase(databasePath, (context) =>
      runDaemonTick(context, {
        now: scheduledAt,
        provider: {
          id: "must-not-run-early",
          kind: "fake",
          capabilities: ["test"],
          run(_input: AgentProviderRunInput) {
            throw new Error("provider should not run before dueAt");
          }
        }
      })
    );
    expect(early.actions).toContainEqual(
      expect.objectContaining({ kind: "retry_blocked", summary: expect.stringContaining("retry not due yet") })
    );

    const due = withDatabase(databasePath, (context) =>
      runDaemonTick(context, {
        now: new Date("2026-05-04T00:00:11.000Z"),
        provider: new FakeAgentProvider("retry due but no tool")
      })
    );
    expect(due.actions).toContainEqual(expect.objectContaining({ kind: "agent_tool_skipped" }));
  });

  it("paused 和 canceled task 不会被 daemon 推进或因 stale session 安排 retry", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    withDatabase(databasePath, (context) => {
      context.db.prepare("UPDATE tasks SET status = ?, state_version = state_version + 1 WHERE id = ?").run("paused", fixture.taskId);
      createAgentSession(context, {
        id: "paused-stale-agent",
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        providerKind: "fake",
        role: "outer",
        status: "running"
      });
      context.db.prepare("UPDATE agent_sessions SET updated_at = ? WHERE id = ?").run("2026-05-03T23:00:00.000Z", "paused-stale-agent");
    });

    const paused = withDatabase(databasePath, (context) =>
      runDaemonTick(context, {
        now: new Date("2026-05-04T00:00:00.000Z"),
        provider: {
          id: "must-not-run-paused",
          kind: "fake",
          capabilities: ["test"],
          run(_input: AgentProviderRunInput) {
            throw new Error("provider should not run for paused task");
          }
        }
      })
    );
    const pausedEvents = withDatabase(databasePath, (context) => listTaskEvents(context, fixture.taskId));
    expect(paused.actions).toContainEqual(expect.objectContaining({ agentSessionId: "paused-stale-agent" }));
    expect(pausedEvents.map((event) => event.type)).not.toContain("daemon.retry_scheduled");
    expect(pausedEvents.find((event) => event.type === "daemon.recovery_decision")?.payload).toMatchObject({
      reasonCode: "task-paused-safe-inspect",
      decision: "safe_inspect_only"
    });

    withDatabase(databasePath, (context) => {
      context.db.prepare("UPDATE tasks SET status = ?, state_version = state_version + 1 WHERE id = ?").run("canceled", fixture.taskId);
    });
    const canceled = withDatabase(databasePath, (context) =>
      runDaemonTick(context, { provider: new FakeAgentProvider("no-op") })
    );
    expect(canceled.actions.some((action) => action.taskId === fixture.taskId && action.kind === "agent_session_started")).toBe(false);
  });

  it("operator retry dueAt 未到期不启动 provider，到期后复用 daemon 恢复路径", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    withDatabase(databasePath, (context) => {
      appendEvent(context, {
        type: "operator.task_retry_requested",
        summary: "operator retry",
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        payload: { dueAt: "2026-05-04T00:00:10.000Z", action: "retry" }
      });
      context.db.prepare("UPDATE tasks SET status = ?, state_version = state_version + 1 WHERE id = ?").run("resuming", fixture.taskId);
    });

    const early = withDatabase(databasePath, (context) =>
      runDaemonTick(context, {
        now: new Date("2026-05-04T00:00:05.000Z"),
        provider: {
          id: "must-not-run-operator-retry",
          kind: "fake",
          capabilities: ["test"],
          run(_input: AgentProviderRunInput) {
            throw new Error("provider should not run before operator retry due");
          }
        }
      })
    );
    expect(early.actions).toContainEqual(
      expect.objectContaining({ kind: "retry_blocked", summary: expect.stringContaining("retry not due yet") })
    );

    const due = withDatabase(databasePath, (context) =>
      runDaemonTick(context, {
        now: new Date("2026-05-04T00:00:11.000Z"),
        provider: new FakeAgentProvider("operator retry due but no tool")
      })
    );
    expect(due.actions).toContainEqual(expect.objectContaining({ kind: "agent_tool_skipped" }));
  });

  it("Coordinator Surface 不暴露内部 recovery tools 或 raw recovery internals", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    withDatabase(databasePath, (context) => {
      appendEvent(context, {
        type: "daemon.recovery_decision",
        summary: "raw internals must stay out of agent surface",
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        payload: {
          decision: "operator_attention",
          providerRawOutput: "secret-provider-output",
          lockToken: "secret-lock-token",
          completeOperationJson: { status: "unknown" }
        }
      });
    });

    const surface = withDatabase(databasePath, (context) => buildTaskSurfaceFromDb(context, fixture.taskId));

    expect(surface.json.available_tools.map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining(["reconcile_resource", "recover_task", "replay_operation", "release_lock"])
    );
    expect(surface.markdown).not.toContain("secret-provider-output");
    expect(surface.markdown).not.toContain("secret-lock-token");
    expect(JSON.stringify(surface.json)).not.toContain("secret-provider-output");
  });

  it("daemon 通过 Core decision 对账 running merge operation，不自行判断 review 或 merge readiness", () => {
    const databasePath = createMigratedDatabase();
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-pr-recovery",
        name: "pr recovery",
        defaultBranch: "main",
        prProviderKind: "github"
      });
      const task = createTask(context, {
        id: "task-pr-recovery",
        projectId: project.id,
        title: "merge recovery"
      });
      const attempt = createAttempt(context, {
        id: "attempt-pr-recovery",
        projectId: project.id,
        taskId: task.id
      });
      const pr = createPullRequest(context, {
        id: "pr-daemon-recovery",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        providerKind: "github",
        status: "merging",
        externalId: "1",
        headBranch: "feature",
        baseBranch: "main",
        headSha: "head-1",
        baseSha: "base-1",
        reviewStatus: "clean",
        validationRunId: "validation-1",
        mergeStrategy: "squash"
      });
      const operation = createOperation(context, {
        idempotencyKey: "merge:pr-daemon-recovery:head-1:base-1:validation-1",
        kind: "merge",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        prId: pr.id
      });
      updateOperation(context, {
        operationId: operation.id,
        status: "running",
        lastObservedState: { phase: "merge", prId: pr.id }
      });
    });

    const result = withDatabase(databasePath, (context) =>
      runDaemonTick(context, {
        pullRequestProvider: new DaemonMergedProvider(),
        provider: new FakeAgentProvider("no-op")
      })
    );
    const state = withDatabase(databasePath, (context) => ({
      pr: getLatestPullRequestByTask(context, "task-pr-recovery"),
      task: context.db.prepare("SELECT status FROM tasks WHERE id = ?").get("task-pr-recovery") as { status: string },
      operation: getOperationByIdempotencyKey(context, "merge:pr-daemon-recovery:head-1:base-1:validation-1"),
      events: listTaskEvents(context, "task-pr-recovery")
    }));

    expect(result.actions).toContainEqual(expect.objectContaining({ kind: "pr_reconciled", taskId: "task-pr-recovery" }));
    expect(state.pr).toMatchObject({ status: "merged" });
    expect(state.task.status).toBe("completed");
    expect(state.operation).toMatchObject({ status: "reconciled" });
    expect(JSON.stringify(state.events)).not.toContain("provider raw");
  });

  it("daemon 不会反复重放已经带 recovery decision 的 failed merge operation", () => {
    const databasePath = createMigratedDatabase();
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-pr-failed",
        name: "pr failed",
        defaultBranch: "main",
        prProviderKind: "github"
      });
      const task = createTask(context, {
        id: "task-pr-failed",
        projectId: project.id,
        title: "merge failed"
      });
      const attempt = createAttempt(context, {
        id: "attempt-pr-failed",
        projectId: project.id,
        taskId: task.id
      });
      const pr = createPullRequest(context, {
        id: "pr-daemon-failed",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        providerKind: "github",
        status: "open",
        headSha: "head-1",
        baseSha: "base-1",
        reviewStatus: "clean",
        validationRunId: "validation-1",
        mergeStrategy: "squash"
      });
      const operation = createOperation(context, {
        idempotencyKey: "merge:pr-daemon-failed:head-1:base-1:validation-1",
        kind: "merge",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        prId: pr.id
      });
      updateOperation(context, {
        operationId: operation.id,
        status: "unknown",
        failureCode: "conflict",
        lastObservedState: {
          phase: "merge-failed",
          failureKind: "conflict",
          decision: "operator_attention",
          reasonCode: "pr-merge-conflict"
        }
      });
    });

    const result = withDatabase(databasePath, (context) =>
      runDaemonTick(context, {
        pullRequestProvider: new DaemonMergedProvider(),
        provider: new FakeAgentProvider("no-op")
      })
    );

    expect(result.actions.some((action) => action.taskId === "task-pr-failed" && action.kind === "pr_reconciled")).toBe(false);
  });

  it("daemon 能释放 owner inactive 的过期 pr-merge lock", () => {
    const databasePath = createMigratedDatabase();
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-pr-lock",
        name: "pr lock",
        defaultBranch: "main",
        prProviderKind: "github"
      });
      const task = createTask(context, {
        id: "task-pr-lock",
        projectId: project.id,
        title: "merge lock"
      });
      const attempt = createAttempt(context, {
        id: "attempt-pr-lock",
        projectId: project.id,
        taskId: task.id
      });
      createPullRequest(context, {
        id: "pr-lock",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        providerKind: "github",
        status: "open"
      });
      acquireLock(context, {
        resourceKind: "pr-merge",
        resourceId: "pr-lock",
        owner: "test",
        ttlMs: 1,
        now: new Date("2026-05-04T00:00:00.000Z")
      });
    });

    const result = withDatabase(databasePath, (context) =>
      runDaemonTick(context, {
        now: new Date("2026-05-04T00:00:01.000Z"),
        provider: new FakeAgentProvider("no-op")
      })
    );
    const lock = withDatabase(databasePath, (context) => getLock(context, "pr-merge", "pr-lock"));

    expect(result.actions).toContainEqual(expect.objectContaining({ kind: "lock_reconciled" }));
    expect(lock).toBeUndefined();
  });
});

class DaemonMergedProvider extends FakePullRequestProvider {
  inspectReview(input: PullRequestProviderReviewInput): PullRequestProviderReviewResult {
    return {
      reviewStatus: "merged",
      reviewSummary: "already merged",
      headSha: input.pr.headSha,
      baseSha: input.pr.baseSha,
      validationRunId: input.pr.validationRunId,
      mergeable: false,
      url: input.pr.url
    };
  }
}
