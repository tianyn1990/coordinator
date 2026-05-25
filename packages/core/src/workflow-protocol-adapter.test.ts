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
  invokeWorkflowActionFromOperator,
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
        progress: { label: "Review", summary: "正在等待 materialize-change 参数", ordinal: 3, total: 4 },
        stageArtifacts: [
          {
            kind: "plan",
            label: "Review notes",
            path: "artifacts/review-notes.md",
            requiredForHandoff: false
          }
        ],
        allowedActions: ["debug-only"],
        actionInputs: {
          "debug-only": {
            requiredArgs: ["change-id"],
            usage: "workflow protocol action --run inner-run-1 debug-only <change-id>"
          }
        },
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
        progress: { label: "PR ready", summary: "handoff evidence prepared", ordinal: 4, total: 4 },
        stageArtifacts: [
          {
            kind: "handoff",
            label: "PR handoff",
            path: "artifacts/pr-handoff.md",
            requiredForHandoff: true
          }
        ],
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

  it("operation-first 以 human explicit profile 启动 workflow run，并在 workspace repo 内执行 protocol", () => {
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
      profileId: "feature",
      selectionSource: "human_explicit",
      requestedProfileId: "feature"
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
      getOperationByIdempotencyKey(context, "workflow:start:attempt-workflow:human:feature")
    );
    expect(operation).toMatchObject({ kind: "workflow:start", status: "succeeded" });
  });

  it("未传 profile 时以 runtime auto selection 启动，并持久化 actual profile", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocol = createProtocolRunner();

    const result = withDatabase(databasePath, (context) =>
      startWorkflowRun(context, {
        attemptId: fixture.attemptId,
        owner: "test-worker",
        runner: protocol.runner
      })
    );

    expect(result.workflowRun).toMatchObject({
      status: "running",
      externalId: "inner-run-1",
      profileId: "feature",
      selectionSource: "runtime_auto",
      requestedProfileId: undefined,
      requestedProfileAlias: "auto"
    });
    expect(protocol.calls.map((call) => call.args)).toEqual([["protocol", "start"]]);

    const operation = withDatabase(databasePath, (context) =>
      getOperationByIdempotencyKey(context, "workflow:start:attempt-workflow:auto")
    );
    expect(operation).toMatchObject({ kind: "workflow:start", status: "succeeded" });
  });

  it("显式传入 auto/default 时也按 runtime auto selection 启动", () => {
    const autoDatabasePath = createMigratedDatabase();
    const autoFixture = createAttemptWithReadyWorkspace(autoDatabasePath);
    const autoProtocol = createProtocolRunner();

    const autoResult = withDatabase(autoDatabasePath, (context) =>
      startWorkflowRun(context, {
        attemptId: autoFixture.attemptId,
        profileId: "auto",
        owner: "test-worker",
        runner: autoProtocol.runner
      })
    );

    expect(autoResult.workflowRun).toMatchObject({
      status: "running",
      profileId: "feature",
      selectionSource: "runtime_auto",
      requestedProfileId: undefined,
      requestedProfileAlias: "auto"
    });
    expect(autoProtocol.calls.map((call) => call.args)).toEqual([["protocol", "start"]]);

    const defaultDatabasePath = createMigratedDatabase();
    const defaultFixture = createAttemptWithReadyWorkspace(defaultDatabasePath);
    const defaultProtocol = createProtocolRunner();
    const defaultResult = withDatabase(defaultDatabasePath, (context) =>
      startWorkflowRun(context, {
        attemptId: defaultFixture.attemptId,
        profileId: "default",
        owner: "test-worker",
        runner: defaultProtocol.runner
      })
    );

    expect(defaultResult.workflowRun).toMatchObject({
      status: "running",
      profileId: "feature",
      selectionSource: "runtime_auto",
      requestedProfileId: undefined,
      requestedProfileAlias: "default"
    });
    expect(defaultProtocol.calls.map((call) => call.args)).toEqual([["protocol", "start"]]);
  });

  it("explicit profile 场景必须返回 actual profile，不能用 requested profile 兜底", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocolRunner = createProtocolRunner();
    const protocol: WorkflowProtocolRunner = (args, options) => {
      if (args[1] === "capabilities") {
        return protocolRunner.runner(args, options);
      }
      return JSON.stringify({
        runId: "inner-run-1",
        protocolVersion: "1",
        lifecycle: "active",
        handoff: { available: false, artifacts: [], deniedActions: [] },
        summary: "started without actual profile"
      });
    };

    expect(() =>
      withDatabase(databasePath, (context) =>
        startWorkflowRun(context, {
          attemptId: fixture.attemptId,
          profileId: "feature",
          owner: "test-worker",
          runner: protocol
        })
      )
    ).toThrow(/actual profile/);
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
      operation: getOperationByIdempotencyKey(context, "workflow:start:attempt-workflow:human:feature"),
      workflowRun: getActiveWorkflowRunByAttempt(context, fixture.attemptId)
    }));
    expect(persisted.operation).toMatchObject({ status: "unknown" });
    expect(persisted.workflowRun).toMatchObject({ status: "starting", profileId: "feature" });
  });

  it("start 返回 protocol failure envelope 时保留可诊断错误摘要", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocol = createProtocolRunner();
    const runner: WorkflowProtocolRunner = (args, options) => {
      if (args[1] === "start") {
        return JSON.stringify({
          ok: false,
          protocolVersion: "1",
          runId: null,
          error: {
            code: "WORKFLOW_PROFILE_REQUIRED",
            message: "workflow protocol start requires --workflow <profile>",
            recoverable: true
          }
        });
      }
      return protocol.runner(args, options);
    };

    expect(() =>
      withDatabase(databasePath, (context) =>
        startWorkflowRun(context, {
          attemptId: fixture.attemptId,
          runner
        })
      )
    ).toThrow(/WORKFLOW_PROFILE_REQUIRED/);

    const persisted = withDatabase(databasePath, (context) => ({
      operation: getOperationByIdempotencyKey(context, "workflow:start:attempt-workflow:auto"),
      workflowRun: getActiveWorkflowRunByAttempt(context, fixture.attemptId)
    }));
    expect(persisted.operation).toMatchObject({
      status: "unknown",
      failureCode: "WorkflowProtocolError",
      lastObservedState: expect.objectContaining({
        error: "WORKFLOW_PROFILE_REQUIRED: workflow protocol start requires --workflow <profile>"
      })
    });
    expect(persisted.workflowRun).toMatchObject({ status: "starting", profileId: "unknown" });
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
    expect(result.status.actionInputHints).toEqual({
      "debug-only": {
        requiredArgs: ["change-id"],
        usage: "workflow protocol action --run inner-run-1 debug-only <change-id>"
      }
    });
    expect(result.status.progress).toEqual({
      label: "Review",
      summary: "正在等待 materialize-change 参数",
      ordinal: 3,
      total: 4
    });
    expect(result.status.stageArtifacts).toEqual([
      {
        kind: "plan",
        label: "Review notes",
        path: "artifacts/review-notes.md",
        requiredForHandoff: false
      }
    ]);

    const events = withDatabase(databasePath, (context) => listTaskEvents(context, fixture.taskId));
    const inspected = events.find((event) => event.type === "workflow.status_inspected");
    expect(inspected?.payload).toMatchObject({
      progress: {
        label: "Review",
        summary: "正在等待 materialize-change 参数",
        ordinal: 3,
        total: 4
      },
      stageArtifacts: [
        {
          kind: "plan",
          label: "Review notes",
          path: "artifacts/review-notes.md",
          requiredForHandoff: false
        }
      ],
      actionInputHints: {
        "debug-only": {
          requiredArgs: ["change-id"],
          usage: "workflow protocol action --run inner-run-1 debug-only <change-id>"
        }
      }
    });
    expect(JSON.stringify(inspected?.payload)).not.toContain('"actionInputs"');
  });

  it("status 返回 runId 不匹配时拒绝持久化，避免通过私有状态猜测恢复", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocol = createProtocolRunner();
    const started = withDatabase(databasePath, (context) =>
      startWorkflowRun(context, { attemptId: fixture.attemptId, profileId: "feature", runner: protocol.runner })
    );
    const mismatchRunner: WorkflowProtocolRunner = (args, options) => {
      if (args[1] === "status") {
        return JSON.stringify({
          runId: "different-inner-run",
          profile: "feature",
          lifecycle: "active",
          handoff: { available: false, artifacts: [], deniedActions: [] },
          summary: "wrong run"
        });
      }
      return protocol.runner(args, options);
    };

    expect(() =>
      withDatabase(databasePath, (context) =>
        inspectWorkflowRun(context, { workflowRunId: started.workflowRun.id, runner: mismatchRunner })
      )
    ).toThrow(WorkflowProtocolError);

    const persisted = withDatabase(databasePath, (context) => getWorkflowRun(context, started.workflowRun.id));
    expect(persisted).toMatchObject({ status: "running", externalId: "inner-run-1" });
  });

  it("status 返回 profile 不匹配时拒绝持久化", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocol = createProtocolRunner();
    const started = withDatabase(databasePath, (context) =>
      startWorkflowRun(context, { attemptId: fixture.attemptId, profileId: "feature", runner: protocol.runner })
    );
    const mismatchRunner: WorkflowProtocolRunner = (args, options) => {
      if (args[1] === "status") {
        return JSON.stringify({
          runId: "inner-run-1",
          profile: "bugfix",
          lifecycle: "active",
          handoff: { available: false, artifacts: [], deniedActions: [] },
          summary: "wrong profile"
        });
      }
      return protocol.runner(args, options);
    };

    expect(() =>
      withDatabase(databasePath, (context) =>
        inspectWorkflowRun(context, { workflowRunId: started.workflowRun.id, runner: mismatchRunner })
      )
    ).toThrow(WorkflowProtocolError);
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
    expect(result.status.progress).toEqual({
      label: "PR ready",
      summary: "handoff evidence prepared",
      ordinal: 4,
      total: 4
    });
    expect(result.status.stageArtifacts).toEqual([
      {
        kind: "handoff",
        label: "PR handoff",
        path: "artifacts/pr-handoff.md",
        requiredForHandoff: true
      }
    ]);
    expect(result.operationId).toBeTruthy();
    const events = withDatabase(databasePath, (context) => listTaskEvents(context, fixture.taskId));
    expect(events.map((event) => event.type)).toContain("workflow.action");
    const actionEvent = events.find((event) => event.type === "workflow.action");
    expect(actionEvent?.payload).toMatchObject({
      progress: {
        label: "PR ready",
        summary: "handoff evidence prepared",
        ordinal: 4,
        total: 4
      },
      stageArtifacts: [
        {
          kind: "handoff",
          label: "PR handoff",
          path: "artifacts/pr-handoff.md",
          requiredForHandoff: true
        }
      ]
    });
    expect(JSON.stringify(actionEvent?.payload)).not.toContain('"actionInputs"');
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

  it("operator workflow action 先校验 latest allowedActions 与 classification 再执行", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocol = createProtocolRunner();
    const operatorRunner: WorkflowProtocolRunner = (args, options) => {
      if (args[1] === "status") {
        protocol.calls.push({ args, cwd: options.cwd, launcher: options.launcher, timeoutMs: options.timeoutMs });
        return JSON.stringify({
          runId: "inner-run-1",
          profile: "feature",
          lifecycle: "active",
          stage: "requirements",
          allowedActions: ["freeze-requirements"],
          handoff: { available: false, artifacts: [], deniedActions: [] },
          summary: "waiting for requirements approval"
        });
      }
      return protocol.runner(args, options);
    };

    const result = withDatabase(databasePath, (context) => {
      const started = startWorkflowRun(context, {
        attemptId: fixture.attemptId,
        profileId: "feature",
        runner: operatorRunner
      });
      return invokeWorkflowActionFromOperator(context, {
        workflowRunId: started.workflowRun.id,
        action: "freeze-requirements",
        expectedStateVersion: started.workflowRun.stateVersion,
        actor: "web-operator",
        runner: operatorRunner
      });
    });

    expect(result.workflowRun.status).toBe("handoff");
    expect(protocol.calls.map((call) => call.args[1])).toEqual(["capabilities", "start", "status", "action"]);
    expect(protocol.calls.find((call) => call.args[1] === "action")?.args).toEqual([
      "protocol",
      "action",
      "--run",
      "inner-run-1",
      "freeze-requirements"
    ]);
  });

  it("operator workflow action 允许 approve-planning-dossier 这类人工 gate", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocol = createProtocolRunner();
    const planningApprovalRunner: WorkflowProtocolRunner = (args, options) => {
      if (args[1] === "status") {
        protocol.calls.push({ args, cwd: options.cwd, launcher: options.launcher, timeoutMs: options.timeoutMs });
        return JSON.stringify({
          runId: "inner-run-1",
          profile: "feature",
          lifecycle: "active",
          stage: "technical-plan",
          allowedActions: ["approve-planning-dossier"],
          handoff: { available: false, artifacts: [], deniedActions: [] },
          summary: "waiting for plan approval"
        });
      }
      return protocol.runner(args, options);
    };

    const result = withDatabase(databasePath, (context) => {
      const started = startWorkflowRun(context, {
        attemptId: fixture.attemptId,
        profileId: "feature",
        runner: planningApprovalRunner
      });
      return invokeWorkflowActionFromOperator(context, {
        workflowRunId: started.workflowRun.id,
        action: "approve-planning-dossier",
        expectedStateVersion: started.workflowRun.stateVersion,
        actor: "web-operator",
        runner: planningApprovalRunner
      });
    });

    expect(result.operationId).toBeTruthy();
    expect(protocol.calls.find((call) => call.args[1] === "action")?.args).toEqual([
      "protocol",
      "action",
      "--run",
      "inner-run-1",
      "approve-planning-dossier"
    ]);
  });

  it("operator workflow action 不在 latest allowedActions 时不执行 protocol action", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocol = createProtocolRunner();

    expect(() =>
      withDatabase(databasePath, (context) => {
        const started = startWorkflowRun(context, {
          attemptId: fixture.attemptId,
          profileId: "feature",
          runner: protocol.runner
        });
        return invokeWorkflowActionFromOperator(context, {
          workflowRunId: started.workflowRun.id,
          action: "freeze-requirements",
          expectedStateVersion: started.workflowRun.stateVersion,
          runner: protocol.runner
        });
      })
    ).toThrow(WorkflowProtocolError);

    expect(protocol.calls.some((call) => call.args[1] === "action")).toBe(false);
  });

  it("operator workflow action 缺少 required arg 时不执行 protocol action", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocol = createProtocolRunner();
    const requiredArgRunner: WorkflowProtocolRunner = (args, options) => {
      if (args[1] === "status") {
        protocol.calls.push({ args, cwd: options.cwd, launcher: options.launcher, timeoutMs: options.timeoutMs });
        return JSON.stringify({
          runId: "inner-run-1",
          profile: "feature",
          lifecycle: "active",
          allowedActions: ["approve-review"],
          actionInputs: {
            "approve-review": {
              requiredArgs: ["review-id"],
              usage: "workflow protocol action --run inner-run-1 approve-review <review-id>"
            }
          },
          handoff: { available: false, artifacts: [], deniedActions: [] },
          summary: "waiting for review approval"
        });
      }
      return protocol.runner(args, options);
    };

    expect(() =>
      withDatabase(databasePath, (context) => {
        const started = startWorkflowRun(context, {
          attemptId: fixture.attemptId,
          profileId: "feature",
          runner: requiredArgRunner
        });
        return invokeWorkflowActionFromOperator(context, {
          workflowRunId: started.workflowRun.id,
          action: "approve-review",
          expectedStateVersion: started.workflowRun.stateVersion,
          runner: requiredArgRunner
        });
      })
    ).toThrow(/需要参数 review-id/);

    expect(protocol.calls.some((call) => call.args[1] === "action")).toBe(false);
  });

  it("operator workflow action 拒绝 materialize-change 这类 agent/internal action", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocol = createProtocolRunner();
    const internalActionRunner: WorkflowProtocolRunner = (args, options) => {
      if (args[1] === "status") {
        protocol.calls.push({ args, cwd: options.cwd, launcher: options.launcher, timeoutMs: options.timeoutMs });
        return JSON.stringify({
          runId: "inner-run-1",
          profile: "feature",
          lifecycle: "active",
          allowedActions: ["materialize-change"],
          actionInputs: {
            "materialize-change": {
              requiredArgs: ["change-id"],
              usage: "workflow protocol action --run inner-run-1 materialize-change <change-id>"
            }
          },
          handoff: { available: false, artifacts: [], deniedActions: [] },
          summary: "implementation needs inner agent"
        });
      }
      return protocol.runner(args, options);
    };

    expect(() =>
      withDatabase(databasePath, (context) => {
        const started = startWorkflowRun(context, {
          attemptId: fixture.attemptId,
          profileId: "feature",
          runner: internalActionRunner
        });
        return invokeWorkflowActionFromOperator(context, {
          workflowRunId: started.workflowRun.id,
          action: "materialize-change",
          arg: "add-web-loop",
          expectedStateVersion: started.workflowRun.stateVersion,
          runner: internalActionRunner
        });
      })
    ).toThrow(/不是 operator-facing gate/);

    expect(protocol.calls.some((call) => call.args[1] === "action")).toBe(false);
  });

  it("operator workflow action 对 unknown action 采取 debug-only 保守拒绝", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocol = createProtocolRunner();

    expect(() =>
      withDatabase(databasePath, (context) => {
        const started = startWorkflowRun(context, {
          attemptId: fixture.attemptId,
          profileId: "feature",
          runner: protocol.runner
        });
        return invokeWorkflowActionFromOperator(context, {
          workflowRunId: started.workflowRun.id,
          action: "debug-only",
          arg: "change-1",
          expectedStateVersion: started.workflowRun.stateVersion,
          runner: protocol.runner
        });
      })
    ).toThrow(/不是 operator-facing gate/);

    expect(protocol.calls.some((call) => call.args[1] === "action")).toBe(false);
  });

  it("operator workflow action 命中 deniedActions 时不执行 protocol action", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createAttemptWithReadyWorkspace(databasePath);
    const protocol = createProtocolRunner();
    const deniedRunner: WorkflowProtocolRunner = (args, options) => {
      if (args[1] === "status") {
        protocol.calls.push({ args, cwd: options.cwd, launcher: options.launcher, timeoutMs: options.timeoutMs });
        return JSON.stringify({
          runId: "inner-run-1",
          profile: "feature",
          lifecycle: "active",
          allowedActions: ["blocked-action"],
          deniedActions: ["blocked-action"],
          handoff: { available: false, artifacts: [], deniedActions: [] },
          summary: "denied"
        });
      }
      return protocol.runner(args, options);
    };

    expect(() =>
      withDatabase(databasePath, (context) => {
        const started = startWorkflowRun(context, {
          attemptId: fixture.attemptId,
          profileId: "feature",
          runner: deniedRunner
        });
        return invokeWorkflowActionFromOperator(context, {
          workflowRunId: started.workflowRun.id,
          action: "blocked-action",
          expectedStateVersion: started.workflowRun.stateVersion,
          runner: deniedRunner
        });
      })
    ).toThrow(/deniedActions/);

    expect(protocol.calls.some((call) => call.args[1] === "action")).toBe(false);
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
