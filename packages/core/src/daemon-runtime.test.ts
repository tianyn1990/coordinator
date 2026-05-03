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
  createProject,
  createTask,
  createWorkspace,
  listTaskEvents,
  runMigrations,
  updateHumanRequest,
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

  it("workflow reconcile 只通过 workflow protocol，不因外部不可用而推进 completed", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const workspacePath = mkdtempSync(join(tmpdir(), "coordinator-daemon-workspace-"));
    const repoPath = join(workspacePath, "repo");
    mkdirSync(join(repoPath, ".git"), { recursive: true });
    const runner: WorkflowProtocolRunner = () => {
      throw new Error("workflow unavailable");
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
        status: "failed"
      })
    );
    const state = withDatabase(databasePath, (context) =>
      context.db.prepare("SELECT status FROM agent_sessions WHERE id = ?").get("stale-agent-session")
    ) as { status: string };
    expect(state.status).toBe("stopped");
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
});
