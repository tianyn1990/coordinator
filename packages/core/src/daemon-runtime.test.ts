import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendEvent,
  createAgentSession,
  createAttempt,
  createExecutionPlan,
  createHumanRequest,
  createOperation,
  createProject,
  createTask,
  createWorkspace,
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
  buildTaskSurfaceFromDb,
  parseAgentToolRequest,
  runDaemonTick,
  type AgentProviderRunInput,
  type WorkflowProtocolRunner
} from "./index.js";

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
        summary: "task snapshot already processed: daemon-planning-v0"
      })
    );
    const events = withDatabase(databasePath, (context) => listTaskEvents(context, "task-daemon"));
    expect(events.filter((event) => event.type === "agent.session_completed")).toHaveLength(1);
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
    const workspacePath = mkdtempSync(join(tmpdir(), "coordinator-daemon-workspace-"));
    const repoPath = join(workspacePath, "repo");
    mkdirSync(join(repoPath, ".git"), { recursive: true });
    const runner: WorkflowProtocolRunner = () => {
      throw new Error("workflow unavailable secret-provider-output lockToken completeOperationJson");
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
        .run("workflow-run-daemon", fixture.projectId, fixture.taskId, attempt.id, "feature", "running", "inner-run");
    });

    const result = withDatabase(databasePath, (context) => runDaemonTick(context, { workflowInspectRunner: runner }));
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
    const recovery = events.find((event) => event.type === "daemon.recovery_decision");
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

  it("workflow runId mismatch 进入 recovery decision，不推进 completed 或 pr_ready", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const workspacePath = mkdtempSync(join(tmpdir(), "coordinator-daemon-workspace-"));
    const repoPath = join(workspacePath, "repo");
    mkdirSync(join(repoPath, ".git"), { recursive: true });
    const runner: WorkflowProtocolRunner = () =>
      JSON.stringify({
        runId: "wrong-inner-run",
        profile: "feature",
        lifecycle: "active",
        handoff: { available: false, artifacts: [], deniedActions: [] },
        summary: "wrong run"
      });

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
        .run("workflow-run-mismatch", fixture.projectId, fixture.taskId, attempt.id, "feature", "running", "inner-run");
    });

    withDatabase(databasePath, (context) => runDaemonTick(context, { workflowInspectRunner: runner }));

    const surface = withDatabase(databasePath, (context) => buildTaskSurfaceFromDb(context, fixture.taskId));
    expect(surface.json.workflow_runs[0]).toMatchObject({ id: "workflow-run-mismatch", status: "running" });
    const events = withDatabase(databasePath, (context) => listTaskEvents(context, fixture.taskId));
    const recovery = events.find((event) => event.type === "daemon.recovery_decision");
    expect(recovery?.payload).toMatchObject({
      reasonCode: "workflow-run-id-mismatch",
      decision: "operator_attention",
      operatorAttentionRequired: true
    });
  });

  it("workflow profile mismatch 进入 recovery decision，不推进 completed 或 pr_ready", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const workspacePath = mkdtempSync(join(tmpdir(), "coordinator-daemon-workspace-"));
    const repoPath = join(workspacePath, "repo");
    mkdirSync(join(repoPath, ".git"), { recursive: true });
    const runner: WorkflowProtocolRunner = () =>
      JSON.stringify({
        runId: "inner-run",
        profile: "bugfix",
        lifecycle: "completed",
        handoff: { available: true, kind: "pr_ready", artifacts: [], deniedActions: [] },
        summary: "wrong profile"
      });

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
        .run("workflow-run-profile-mismatch", fixture.projectId, fixture.taskId, attempt.id, "feature", "running", "inner-run");
    });

    withDatabase(databasePath, (context) => runDaemonTick(context, { workflowInspectRunner: runner }));

    const surface = withDatabase(databasePath, (context) => buildTaskSurfaceFromDb(context, fixture.taskId));
    expect(surface.json.workflow_runs[0]).toMatchObject({ id: "workflow-run-profile-mismatch", status: "running" });
    const events = withDatabase(databasePath, (context) => listTaskEvents(context, fixture.taskId));
    const recovery = events.find((event) => event.type === "daemon.recovery_decision");
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
});
