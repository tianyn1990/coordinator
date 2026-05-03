import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createAttempt,
  createProject,
  createTask,
  createWorkspace,
  getOperationByIdempotencyKey,
  getWorkflowRun,
  getActiveWorkflowRunByAttempt,
  listTaskEvents,
  runMigrations,
  withDatabase
} from "@coordinator/db";
import {
  WorkflowProtocolError,
  inspectWorkflowCapabilities,
  inspectWorkflowRun,
  invokeWorkflowAction,
  listWorkflowArtifacts,
  listWorkflowEvents,
  startWorkflowRun,
  type WorkflowProtocolRunner
} from "./index.js";

function createMigratedDatabase(): string {
  const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-workflow-db-")), "workflow.sqlite");
  runMigrations(databasePath);
  return databasePath;
}

function createRepoPath(): string {
  const repoPath = mkdtempSync(join(tmpdir(), "coordinator-workflow-repo-"));
  mkdirSync(join(repoPath, ".git"));
  return repoPath;
}

function createAttemptWithReadyWorkspace(databasePath: string) {
  const projectRepoPath = createRepoPath();
  const workspacePath = mkdtempSync(join(tmpdir(), "coordinator-workflow-workspace-"));
  const workspaceRepoPath = join(workspacePath, "repo");
  mkdirSync(workspaceRepoPath, { recursive: true });
  mkdirSync(join(workspaceRepoPath, ".git"));

  const ids = withDatabase(databasePath, (context) => {
    const project = createProject(context, {
      id: "project-workflow",
      name: "workflow",
      repoPath: projectRepoPath,
      defaultBranch: "main",
      workflowLauncher: "workflow"
    });
    const task = createTask(context, { id: "task-workflow", projectId: project.id, title: "workflow" });
    const attempt = createAttempt(context, { id: "attempt-workflow", projectId: project.id, taskId: task.id });
    const workspace = createWorkspace(context, {
      id: "workspace-workflow",
      projectId: project.id,
      taskId: task.id,
      attemptId: attempt.id,
      status: "ready",
      workspacePath,
      repoPath: workspaceRepoPath,
      branch: "coordinator/task-workflow/attempt-workflow",
      baseBranch: "main"
    });
    return { projectId: project.id, taskId: task.id, attemptId: attempt.id, workspaceId: workspace.id };
  });

  return { ...ids, projectRepoPath, workspacePath, workspaceRepoPath };
}

function createProtocolRunner() {
  const calls: Array<{ args: string[]; cwd: string; launcher: string; timeoutMs: number }> = [];
  const runner: WorkflowProtocolRunner = (args, options) => {
    calls.push({ args, cwd: options.cwd, launcher: options.launcher, timeoutMs: options.timeoutMs });
    const command = args[1];
    if (command === "capabilities") {
      return JSON.stringify({
        protocolVersion: "1",
        profiles: [
          { id: "feature", purpose: "feature work", implemented: true },
          { id: "bugfix", purpose: "bugfix work", implemented: true },
          { id: "future", purpose: "future work", implemented: false }
        ],
        commands: ["start", "status", "action", "artifacts", "events"],
        handoffKinds: ["pr_ready", "blocked", "human_review_required", "manual_handoff", "completed_no_pr"]
      });
    }
    if (command === "start") {
      return JSON.stringify({
        runId: "inner-run-1",
        profile: "feature",
        lifecycle: "active",
        stage: "requirements",
        substate: null,
        handoff: { available: false, artifacts: [], deniedActions: [] },
        summary: "started"
      });
    }
    if (command === "status") {
      return JSON.stringify({
        runId: "inner-run-1",
        profile: "feature",
        lifecycle: "active",
        stage: "review",
        substate: "complete-looking-debug-only",
        gate: { state: "open" },
        allowedActions: ["debug-only"],
        handoff: { available: false, artifacts: [], deniedActions: ["create-pr-from-coordinator"] },
        summary: "no handoff yet"
      });
    }
    if (command === "action") {
      return JSON.stringify({
        runId: "inner-run-1",
        profile: "feature",
        lifecycle: "active",
        handoff: {
          available: true,
          kind: "pr_ready",
          reason: "ready",
          artifacts: [{ kind: "summary", path: ".workflow/runs/inner-run-1/artifacts/summary.md" }],
          deniedActions: []
        },
        summary: "handoff ready"
      });
    }
    if (command === "artifacts") {
      return JSON.stringify({
        runId: "inner-run-1",
        artifactRoot: ".workflow/runs/inner-run-1/artifacts",
        artifacts: [{ kind: "summary", path: ".workflow/runs/inner-run-1/artifacts/summary.md", requiredForHandoff: true }]
      });
    }
    if (command === "events") {
      return JSON.stringify({
        runId: "inner-run-1",
        eventsPath: ".workflow/runs/inner-run-1/observability/events.jsonl",
        latest: [{ type: "workflow-action", summary: "ran" }]
      });
    }
    throw new Error(`unexpected command: ${command}`);
  };
  return { runner, calls };
}

describe("workflow protocol adapter", () => {
  it("查询 capabilities 并校验 protocol version", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocol = createProtocolRunner();

    const result = withDatabase(databasePath, (context) =>
      inspectWorkflowCapabilities(context, { projectId: fixture.projectId, runner: protocol.runner })
    );

    expect(result.profiles).toContainEqual({ id: "feature", purpose: "feature work", implemented: true });
    expect(protocol.calls[0]).toMatchObject({
      args: ["protocol", "capabilities"],
      cwd: fixture.projectRepoPath,
      launcher: "workflow"
    });
  });

  it("启动 workflow run 时要求 profile 来自 capabilities implemented", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocol = createProtocolRunner();

    expect(() =>
      withDatabase(databasePath, (context) =>
        startWorkflowRun(context, { attemptId: fixture.attemptId, profileId: "future", runner: protocol.runner })
      )
    ).toThrow(WorkflowProtocolError);

    expect(protocol.calls.some((call) => call.args[1] === "start")).toBe(false);
  });

  it("operation-first 启动 workflow run，并在 workspace repo 内执行 protocol", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocol = createProtocolRunner();

    const result = withDatabase(databasePath, (context) =>
      startWorkflowRun(context, {
        attemptId: fixture.attemptId,
        profileId: "feature",
        owner: "test-worker",
        runner: protocol.runner
      })
    );

    expect(result.workflowRun).toMatchObject({
      status: "running",
      externalId: "inner-run-1",
      profileId: "feature"
    });
    expect(result.reused).toBe(false);
    expect(protocol.calls.map((call) => call.args)).toEqual([
      ["protocol", "capabilities"],
      ["protocol", "start", "--workflow", "feature"]
    ]);
    expect(protocol.calls[0].cwd).toBe(fixture.projectRepoPath);
    expect(protocol.calls[1].cwd).toBe(fixture.workspaceRepoPath);
    expect(protocol.calls[1].timeoutMs).toBe(120_000);

    const operation = withDatabase(databasePath, (context) =>
      getOperationByIdempotencyKey(context, "workflow:start:attempt-workflow:feature")
    );
    expect(operation).toMatchObject({ kind: "workflow:start", status: "succeeded" });
  });

  it("start side effect 抛错后保留 starting workflow run 并将 operation 标记 unknown", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocol = createProtocolRunner();
    const runner: WorkflowProtocolRunner = (args, options) => {
      if (args[1] === "start") {
        throw new Error("timeout after external start");
      }
      return protocol.runner(args, options);
    };

    expect(() =>
      withDatabase(databasePath, (context) =>
        startWorkflowRun(context, {
          attemptId: fixture.attemptId,
          profileId: "feature",
          runner
        })
      )
    ).toThrow(/timeout after external start/);

    const persisted = withDatabase(databasePath, (context) => ({
      operation: getOperationByIdempotencyKey(context, "workflow:start:attempt-workflow:feature"),
      workflowRun: getActiveWorkflowRunByAttempt(context, fixture.attemptId)
    }));
    expect(persisted.operation).toMatchObject({ status: "unknown" });
    expect(persisted.workflowRun).toMatchObject({ status: "starting", profileId: "feature" });
  });

  it("status 不把 stage/substate 当成 handoff 或完成语义", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocol = createProtocolRunner();

    const result = withDatabase(databasePath, (context) => {
      const started = startWorkflowRun(context, {
        attemptId: fixture.attemptId,
        profileId: "feature",
        runner: protocol.runner
      });
      return inspectWorkflowRun(context, { workflowRunId: started.workflowRun.id, runner: protocol.runner });
    });

    expect(result.workflowRun).toMatchObject({ status: "running", handoffKind: undefined });
    expect(result.status.debug).toMatchObject({ stage: "review", substate: "complete-looking-debug-only" });
  });

  it("action 返回 pr_ready handoff 时只更新 workflow run handoff，不推进 task", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocol = createProtocolRunner();

    const result = withDatabase(databasePath, (context) => {
      const started = startWorkflowRun(context, {
        attemptId: fixture.attemptId,
        profileId: "feature",
        runner: protocol.runner
      });
      return invokeWorkflowAction(context, {
        workflowRunId: started.workflowRun.id,
        action: "continue",
        expectedStateVersion: started.workflowRun.stateVersion,
        runner: protocol.runner
      });
    });

    expect(result.workflowRun).toMatchObject({ status: "handoff", handoffKind: "pr_ready" });
    expect(result.operationId).toBeTruthy();
    const events = withDatabase(databasePath, (context) => listTaskEvents(context, fixture.taskId));
    expect(events.map((event) => event.type)).toContain("workflow.action");
    expect(events.map((event) => event.type)).not.toContain("task.status_updated");
  });

  it("同一 workflow run 后续 state version 可再次执行同名 action", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocol = createProtocolRunner();

    const result = withDatabase(databasePath, (context) => {
      const started = startWorkflowRun(context, {
        attemptId: fixture.attemptId,
        profileId: "feature",
        runner: protocol.runner
      });
      const first = invokeWorkflowAction(context, {
        workflowRunId: started.workflowRun.id,
        action: "continue",
        expectedStateVersion: started.workflowRun.stateVersion,
        runner: protocol.runner
      });
      const second = invokeWorkflowAction(context, {
        workflowRunId: first.workflowRun.id,
        action: "continue",
        expectedStateVersion: first.workflowRun.stateVersion,
        runner: protocol.runner
      });
      return { first, second };
    });

    expect(result.first.workflowRun.stateVersion).toBe(2);
    expect(result.second.workflowRun.stateVersion).toBe(3);
    expect(protocol.calls.filter((call) => call.args[1] === "action")).toHaveLength(2);
  });

  it("同一 expected version 重试 action 不会再次执行 protocol action", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocol = createProtocolRunner();

    const result = withDatabase(databasePath, (context) => {
      const started = startWorkflowRun(context, {
        attemptId: fixture.attemptId,
        profileId: "feature",
        runner: protocol.runner
      });
      const first = invokeWorkflowAction(context, {
        workflowRunId: started.workflowRun.id,
        action: "continue",
        expectedStateVersion: started.workflowRun.stateVersion,
        runner: protocol.runner
      });
      const replay = invokeWorkflowAction(context, {
        workflowRunId: started.workflowRun.id,
        action: "continue",
        expectedStateVersion: started.workflowRun.stateVersion,
        runner: protocol.runner
      });
      return { first, replay };
    });

    expect(result.replay.operationId).toBe(result.first.operationId);
    expect(result.replay.reused).toBe(true);
    expect(protocol.calls.filter((call) => call.args[1] === "action")).toHaveLength(1);
  });

  it("action arg 规范化后参与 protocol 入参与 idempotency key", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocol = createProtocolRunner();

    const result = withDatabase(databasePath, (context) => {
      const started = startWorkflowRun(context, {
        attemptId: fixture.attemptId,
        profileId: "feature",
        runner: protocol.runner
      });
      const first = invokeWorkflowAction(context, {
        workflowRunId: started.workflowRun.id,
        action: "continue",
        arg: " payload ",
        expectedStateVersion: started.workflowRun.stateVersion,
        runner: protocol.runner
      });
      const replay = invokeWorkflowAction(context, {
        workflowRunId: started.workflowRun.id,
        action: "continue",
        arg: "payload",
        expectedStateVersion: started.workflowRun.stateVersion,
        runner: protocol.runner
      });
      return { first, replay };
    });

    expect(result.replay.operationId).toBe(result.first.operationId);
    expect(protocol.calls.filter((call) => call.args[1] === "action")).toHaveLength(1);
    expect(protocol.calls.find((call) => call.args[1] === "action")?.args).toContain("payload");
    expect(protocol.calls.find((call) => call.args[1] === "action")?.args).not.toContain(" payload ");
  });

  it("artifacts/events 只返回 protocol 暴露的只读引用并记录外层 event", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocol = createProtocolRunner();

    const result = withDatabase(databasePath, (context) => {
      const started = startWorkflowRun(context, {
        attemptId: fixture.attemptId,
        profileId: "feature",
        runner: protocol.runner
      });
      return {
        artifacts: listWorkflowArtifacts(context, { workflowRunId: started.workflowRun.id, runner: protocol.runner }),
        events: listWorkflowEvents(context, { workflowRunId: started.workflowRun.id, runner: protocol.runner })
      };
    });

    expect(result.artifacts.artifacts).toEqual([
      { kind: "summary", path: ".workflow/runs/inner-run-1/artifacts/summary.md", requiredForHandoff: true }
    ]);
    expect(result.events.latest).toEqual([{ type: "workflow-action", summary: "ran" }]);
    const events = withDatabase(databasePath, (context) => listTaskEvents(context, fixture.taskId));
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["workflow.artifacts_inspected", "workflow.events_inspected"])
    );
  });

  it("不读取或写入 .workflow private state", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const privateStatePath = join(fixture.workspaceRepoPath, ".workflow", "runs", "inner-run-1", "state.json");
    mkdirSync(join(fixture.workspaceRepoPath, ".workflow", "runs", "inner-run-1"), { recursive: true });
    writeFileSync(privateStatePath, "sentinel");
    const protocol = createProtocolRunner();

    withDatabase(databasePath, (context) =>
      startWorkflowRun(context, {
        attemptId: fixture.attemptId,
        profileId: "feature",
        runner: protocol.runner
      })
    );

    expect(existsSync(privateStatePath)).toBe(true);
    expect(readFileSync(privateStatePath, "utf8")).toBe("sentinel");
  });

  it("复用 active workflow run 时不重复 start", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocol = createProtocolRunner();

    const result = withDatabase(databasePath, (context) => {
      const first = startWorkflowRun(context, {
        attemptId: fixture.attemptId,
        profileId: "feature",
        runner: protocol.runner
      });
      const second = startWorkflowRun(context, {
        attemptId: fixture.attemptId,
        profileId: "feature",
        runner: protocol.runner
      });
      return { first, second, persisted: getWorkflowRun(context, first.workflowRun.id) };
    });

    expect(result.second.workflowRun.id).toBe(result.first.workflowRun.id);
    expect(result.second.reused).toBe(true);
    expect(result.persisted?.status).toBe("running");
    expect(protocol.calls.filter((call) => call.args[1] === "start")).toHaveLength(1);
    expect(protocol.calls.filter((call) => call.args[1] === "status")).toHaveLength(1);
  });

  it("复用 active workflow run 时 profile 不一致会拒绝", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocol = createProtocolRunner();

    expect(() =>
      withDatabase(databasePath, (context) => {
        startWorkflowRun(context, {
          attemptId: fixture.attemptId,
          profileId: "feature",
          runner: protocol.runner
        });
        startWorkflowRun(context, {
          attemptId: fixture.attemptId,
          profileId: "bugfix",
          runner: protocol.runner
        });
      })
    ).toThrow(/已有 active workflow run/);
    expect(protocol.calls.filter((call) => call.args[1] === "start")).toHaveLength(1);
  });
});
