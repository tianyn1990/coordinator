import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ActiveResourceConflictError,
  createAttempt,
  appendEvent,
  createHumanRequest,
  createExecutionPlan,
  createOperation,
  createProject,
  createPullRequest,
  createTask,
  createWorkspace,
  listTaskEvents,
  runMigrations,
  updateOperation,
  withDatabase
} from "@coordinator/db";
import {
  OperatorSurfaceError,
  buildTaskSurfaceFromDb,
  controlTaskRuntime,
  createManualTask,
  getOperatorTaskDetail,
  getOperatorExecutionSummary,
  listOperatorTasks,
  recordHumanAnswerRuntime
} from "./index.js";

function createMigratedDatabase(): string {
  const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-operator-db-")), "operator.sqlite");
  runMigrations(databasePath);
  return databasePath;
}

describe("operator surface", () => {
  it("Web manual source 可创建 task，并在 operator list 中展示 project", () => {
    const databasePath = createMigratedDatabase();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-operator-workspaces-"));

    const result = withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-web-task",
        name: "web task",
        workspaceRoot
      });
      const task = createManualTask(context, {
        projectId: project.id,
        title: "实现 Web 操作面",
        description: "手动任务",
        autonomy: "balanced"
      });
      return { task, tasks: listOperatorTasks(context) };
    });

    expect(result.task).toMatchObject({
      sourceKind: "manual",
      title: "实现 Web 操作面",
      autonomy: "balanced"
    });
    expect(result.tasks[0]).toMatchObject({
      id: result.task.id,
      projectName: "web task"
    });
  });

  it("task detail 聚合 operator 需要的机器事实，但 agent guidance 仍来自 surface", () => {
    const databasePath = createMigratedDatabase();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-operator-workspaces-"));

    const detail = withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-detail",
        name: "detail",
        workspaceRoot,
        defaultBranch: "main"
      });
      const task = createTask(context, { id: "task-detail", projectId: project.id, title: "detail" });
      const attempt = createAttempt(context, { id: "attempt-detail", projectId: project.id, taskId: task.id });
      createWorkspace(context, {
        id: "workspace-detail",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        status: "ready",
        workspacePath: join(workspaceRoot, "project-detail", "task-detail", "attempt-detail"),
        repoPath: join(workspaceRoot, "project-detail", "task-detail", "attempt-detail", "repo"),
        branch: "coordinator/task-detail/attempt-detail",
        baseBranch: "main"
      });
      createPullRequest(context, {
        id: "pr-detail",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        providerKind: "github",
        status: "open"
      });
      return getOperatorTaskDetail(context, task.id);
    });

    expect(detail).toMatchObject({
      task: { id: "task-detail" },
      attempt: { id: "attempt-detail" },
      workspace: { id: "workspace-detail" },
      latestPullRequest: { id: "pr-detail" },
      currentBlocker: "waiting PR/MR: open"
    });
    expect(detail.surface.json.task.id).toBe("task-detail");
    expect(detail.surface.json.available_tools.map((tool) => tool.name)).not.toContain("record_human_answer");
  });

  it("task detail diagnosis 聚合 recovery、retry、operation 和 inspect 摘要且不泄漏内部字段", () => {
    const databasePath = createMigratedDatabase();
    const detail = withDatabase(databasePath, (context) => {
      const project = createProject(context, { id: "project-diagnosis", name: "diagnosis" });
      const task = createTask(context, { id: "task-diagnosis", projectId: project.id, title: "diagnosis" });
      const attempt = createAttempt(context, { id: "attempt-diagnosis", projectId: project.id, taskId: task.id });
      context.db
        .prepare(
          `INSERT INTO workflow_runs (id, project_id, task_id, attempt_id, profile_id, status, external_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("run-1", project.id, task.id, attempt.id, "feature", "unknown", "inner-run-1");
      const operation = createOperation(context, {
        id: "operation-diagnosis",
        idempotencyKey: "daemon:diagnosis",
        kind: "daemon:workflow:inspect",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id
      });
      updateOperation(context, {
        operationId: operation.id,
        status: "unknown",
        failureCode: "auth_missing",
        lastObservedState: {
          decision: "operator_attention",
          reasonCode: "workflow-run-id-mismatch",
          error: "workflow protocol runId mismatch",
          observedSummary: "protocol mismatch with raw secret token should be truncated",
          lockToken: "must-not-leak",
          raw: { stdout: "provider raw output" }
        }
      });
      context.db
        .prepare(
          `INSERT INTO events (type, summary, project_id, task_id, attempt_id, workflow_run_id, operation_id, severity, payload_json, artifact_refs_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "daemon.recovery_decision",
          "workflow-run-id-mismatch: workflow_run:run-1",
          project.id,
          task.id,
          attempt.id,
          "run-1",
          operation.id,
          "warn",
          JSON.stringify({
            tickId: "tick-1",
            resourceKind: "workflow_run",
            resourceId: "run-1",
            operationId: operation.id,
            decision: "operator_attention",
            reasonCode: "workflow-run-id-mismatch",
            observedSummary: "workflow protocol runId mismatch",
            nextAction: "operator_review",
            operatorAttentionRequired: true,
            lockToken: "must-not-leak",
            raw: { stdout: "provider raw output" },
            artifactRefs: ["diagnostics/workflow.md"]
          }),
          JSON.stringify(["diagnostics/workflow.md"])
        );
      context.db
        .prepare(
          `INSERT INTO events (type, summary, project_id, task_id, attempt_id, operation_id, severity, payload_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "daemon.retry_scheduled",
          "retry later",
          project.id,
          task.id,
          attempt.id,
          operation.id,
          "info",
          JSON.stringify({ dueAt: "2026-05-05T01:00:00.000Z", reason: "transient" })
        );
      context.db
        .prepare(
          `INSERT INTO events (type, summary, project_id, task_id, attempt_id, workflow_run_id, operation_id, severity)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run("workflow.status_inspected", "workflow status inspected", project.id, task.id, attempt.id, "run-1", operation.id, "debug");
      return getOperatorTaskDetail(context, task.id);
    });

    expect(detail.diagnosis.operatorAttention).toMatchObject({
      required: true,
      reasons: expect.arrayContaining(["workflow-run-id-mismatch"])
    });
    expect(detail.diagnosis.retryBudget).toMatchObject({
      scheduledCount: 1,
      latestDueAt: "2026-05-05T01:00:00.000Z"
    });
    expect(detail.diagnosis.recoveryTimeline[0]).toMatchObject({
      decision: "operator_attention",
      reasonCode: "workflow-run-id-mismatch",
      artifactRefs: ["diagnostics/workflow.md"]
    });
    expect(detail.diagnosis.operationLedger[0]).toMatchObject({
      id: "operation-diagnosis",
      status: "unknown",
      failureCode: "auth_missing",
      lastDecision: "operator_attention",
      lastReasonCode: "workflow-run-id-mismatch",
      lastError: "workflow protocol runId mismatch"
    });
    expect(detail.diagnosis.providerProtocolInspections.map((item) => item.type)).toEqual(
      expect.arrayContaining(["daemon.recovery_decision", "workflow.status_inspected"])
    );
    expect(detail.diagnosis.providerProtocolInspections.map((item) => item.type)).not.toContain("pr.merged");
    expect(JSON.stringify(detail.diagnosis)).not.toContain("must-not-leak");
    expect(JSON.stringify(detail.diagnosis)).not.toContain("provider raw output");
    expect(detail.surface.json.available_tools.map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining(["recover_task", "replay_operation", "release_lock", "daemon_tick"])
    );
  });

  it("execution summary 按链路分组展示状态、tool 和 extra artifact，且不污染 surface", () => {
    const databasePath = createMigratedDatabase();
    const summary = withDatabase(databasePath, (context) => {
      const project = createProject(context, { id: "project-summary", name: "summary", defaultBranch: "main" });
      const task = createTask(context, { id: "task-summary", projectId: project.id, title: "summary" });
      createExecutionPlan(context, {
        id: "plan-summary",
        projectId: project.id,
        taskId: task.id,
        status: "active",
        artifactPath: "execution-plan.md"
      });
      const attempt = createAttempt(context, { id: "attempt-summary", projectId: project.id, taskId: task.id });
      createWorkspace(context, {
        id: "workspace-summary",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        status: "ready",
        workspacePath: "/tmp/workspace-summary",
        branch: "coordinator/task-summary/attempt-summary"
      });
      context.db
        .prepare(
          `INSERT INTO workflow_runs (id, project_id, task_id, attempt_id, profile_id, status, external_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("workflow-summary", project.id, task.id, attempt.id, "feature", "running", "inner-summary");
      appendEvent(context, {
        type: "workflow.status_inspected",
        summary: "workflow status inspected",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        workflowRunId: "workflow-summary",
        payload: {
          lifecycle: "active",
          summary: "implementation continues in workflow runtime",
          handoff: { available: false, artifacts: [] },
          actionInputHints: {
            "materialize-change": {
              requiredArgs: ["change-id"],
              usage: "workflow protocol action --run inner-summary materialize-change <change-id>"
            }
          },
          debug: {
            allowedActions: ["materialize-change"]
          }
        }
      });
      appendEvent(context, {
        type: "daemon.agent_extra_artifact_written",
        summary: "agent wrote extra coordinator artifacts for create_attempt",
        projectId: project.id,
        taskId: task.id,
        artifactRefs: ["note.md"],
        payload: {
          toolName: "create_attempt",
          artifactCount: 1,
          artifactRefs: ["note.md"],
          classification: "extra-artifact-for-non-artifact-tool"
        },
        severity: "debug"
      });
      return getOperatorExecutionSummary(context, task.id);
    });

    expect(summary).toMatchObject({
      task: { id: "task-summary" },
      attempt: { id: "attempt-summary" },
      workspace: { id: "workspace-summary", status: "ready" },
      workflow: {
        id: "workflow-summary",
        status: "running",
        externalId: "inner-summary",
        observation: {
          mode: "observing-runtime",
          owner: "workflow-runtime",
          agentInternalActions: ["materialize-change"]
        }
      }
    });
    expect(summary.coordinatorTools).toContainEqual(
      expect.objectContaining({ toolName: "create_attempt", extraArtifact: true, artifactRefs: ["note.md"] })
    );
    expect(summary.artifacts).toContainEqual(expect.objectContaining({ path: "note.md", extra: true }));
    expect(summary.nextStep.availableTools).toEqual(["inspect_workflow_run", "ask_human"]);
  });

  it("operator detail 和 execution summary 展示 agent activity 摘要且不泄漏 raw provider payload", () => {
    const databasePath = createMigratedDatabase();
    const rawSecret = "secret-provider-stdout-lock-token";
    const result = withDatabase(databasePath, (context) => {
      const project = createProject(context, { id: "project-agent-activity", name: "agent activity" });
      const task = createTask(context, { id: "task-agent-activity", projectId: project.id, title: "agent activity" });
      context.db
        .prepare(
          `INSERT INTO agent_sessions (
             id, project_id, task_id, provider_kind, role, status, transcript_path, final_response_path
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run("agent-activity", project.id, task.id, "codex", "outer", "completed", "/tmp/raw-events.jsonl", "/tmp/final-response.md");
      appendEvent(context, {
        type: "agent.session_completed",
        summary: "agent completed",
        projectId: project.id,
        taskId: task.id,
        agentSessionId: "agent-activity",
        payload: {
          raw: rawSecret,
          agentActivity: {
            state: "completed",
            providerId: "codex",
            implementationMode: "sdk",
            permissionProfile: "codex:read-only:approval-never",
            lastActivityAt: "2026-05-25T00:00:00.000Z",
            latestEvent: {
              kind: "turn_completed",
              summary: "codex turn completed",
              severity: "debug"
            },
            eventCount: 3,
            artifactRefs: {
              rawEventArtifactPath: "/tmp/raw-events.jsonl",
              finalResponsePath: "/tmp/final-response.md"
            }
          }
        }
      });
      return {
        detail: getOperatorTaskDetail(context, task.id),
        summary: getOperatorExecutionSummary(context, task.id),
        surface: buildTaskSurfaceFromDb(context, task.id)
      };
    });

    expect(result.detail.agentSessions[0].activity).toMatchObject({
      state: "completed",
      latestEvent: { kind: "turn_completed" },
      artifactRefs: { finalResponsePath: "/tmp/final-response.md" }
    });
    expect(result.summary.agentSessions[0].activity).toMatchObject({
      implementationMode: "sdk",
      permissionProfile: "codex:read-only:approval-never"
    });
    expect(JSON.stringify(result.summary)).not.toContain(rawSecret);
    expect(JSON.stringify(result.surface.json)).not.toContain(rawSecret);
    expect(JSON.stringify(result.surface.json)).not.toContain("codex:read-only:approval-never");
    expect(JSON.stringify(result.surface.json)).not.toContain("/tmp/raw-events.jsonl");
    expect(JSON.stringify(result.surface.json)).toContain("/tmp/final-response.md");
    expect(result.surface.markdown).not.toContain(rawSecret);
  });

  it("diagnosis 当前 attention 只看当前实体，历史 workflow/PR/session 不污染当前状态", () => {
    const databasePath = createMigratedDatabase();
    const detail = withDatabase(databasePath, (context) => {
      const project = createProject(context, { id: "project-current-diagnosis", name: "current diagnosis" });
      const task = createTask(context, { id: "task-current-diagnosis", projectId: project.id, title: "current diagnosis" });
      const oldAttempt = createAttempt(context, { id: "attempt-1-old", projectId: project.id, taskId: task.id });
      createPullRequest(context, {
        id: "pr-old",
        projectId: project.id,
        taskId: task.id,
        attemptId: oldAttempt.id,
        providerKind: "github",
        status: "closed"
      });
      context.db
        .prepare(
          `INSERT INTO workflow_runs (id, project_id, task_id, attempt_id, profile_id, status, external_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("workflow-old", project.id, task.id, oldAttempt.id, "feature", "blocked", "inner-old");
      context.db
        .prepare(
          `INSERT INTO agent_sessions (id, project_id, task_id, attempt_id, provider_kind, role, status)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("agent-old", project.id, task.id, oldAttempt.id, "fake", "outer", "stalled");
      context.db
        .prepare(
          `INSERT INTO events (type, summary, project_id, task_id, attempt_id, workflow_run_id, severity, payload_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "daemon.recovery_decision",
          "old workflow requires operator attention",
          project.id,
          task.id,
          oldAttempt.id,
          "workflow-old",
          "warn",
          JSON.stringify({
            resourceKind: "workflow_run",
            resourceId: "workflow-old",
            decision: "operator_attention",
            reasonCode: "old-workflow-blocked",
            observedSummary: "old workflow blocked",
            nextAction: "operator_review",
            operatorAttentionRequired: true
          })
        );
      const currentAttempt = createAttempt(context, { id: "attempt-z-current", projectId: project.id, taskId: task.id });
      createWorkspace(context, {
        id: "workspace-current",
        projectId: project.id,
        taskId: task.id,
        attemptId: currentAttempt.id,
        status: "ready",
        workspacePath: "/tmp/current",
        repoPath: "/tmp/current/repo",
        branch: "coordinator/current",
        baseBranch: "main"
      });
      context.db
        .prepare(
          `INSERT INTO events (type, summary, project_id, task_id, severity)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run("pr.merged", "historical merge action", project.id, task.id, "info");
      return getOperatorTaskDetail(context, task.id);
    });

    expect(detail.currentBlocker).toBe("created");
    expect(detail.diagnosis.operatorAttention).toMatchObject({
      required: false,
      reasons: []
    });
    expect(detail.diagnosis.providerProtocolInspections.map((item) => item.type)).not.toContain("pr.merged");
  });

  it("operator detail 能展示当前 blocked workspace 作为 blocker 和 attention", () => {
    const databasePath = createMigratedDatabase();
    const detail = withDatabase(databasePath, (context) => {
      const project = createProject(context, { id: "project-blocked-workspace", name: "blocked workspace" });
      const task = createTask(context, { id: "task-blocked-workspace", projectId: project.id, title: "blocked workspace" });
      const attempt = createAttempt(context, { id: "attempt-blocked-workspace", projectId: project.id, taskId: task.id });
      createWorkspace(context, {
        id: "workspace-blocked",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        status: "ready",
        workspacePath: "/tmp/blocked",
        repoPath: "/tmp/blocked/repo",
        branch: "coordinator/blocked",
        baseBranch: "main"
      });
      context.db.prepare("UPDATE workspaces SET status = ? WHERE id = ?").run("blocked", "workspace-blocked");
      return getOperatorTaskDetail(context, task.id);
    });

    expect(detail.workspace).toMatchObject({ id: "workspace-blocked", status: "blocked" });
    expect(detail.currentBlocker).toBe("workspace blocked: workspace-blocked");
    expect(detail.diagnosis.operatorAttention).toMatchObject({
      required: true,
      reasons: expect.arrayContaining(["workspace blocked: workspace-blocked"])
    });
  });

  it("controlTaskRuntime 通过 Core gate 暂停、恢复、retry 和取消 task，并写入 operator event", () => {
    const databasePath = createMigratedDatabase();

    const result = withDatabase(databasePath, (context) => {
      const project = createProject(context, { id: "project-control", name: "control" });
      const task = createTask(context, { id: "task-control", projectId: project.id, title: "control" });
      const paused = controlTaskRuntime(context, {
        taskId: task.id,
        expectedStateVersion: task.stateVersion,
        action: "pause",
        reason: "operator pause",
        actor: "operator"
      });
      const resumed = controlTaskRuntime(context, {
        taskId: task.id,
        expectedStateVersion: paused.task.stateVersion,
        action: "resume",
        actor: "operator",
        now: new Date("2026-05-04T00:00:00.000Z")
      });
      const retried = controlTaskRuntime(context, {
        taskId: task.id,
        expectedStateVersion: resumed.task.stateVersion,
        action: "retry",
        actor: "operator",
        now: new Date("2026-05-04T00:01:00.000Z"),
        retryDelayMs: 5_000
      });
      const canceled = controlTaskRuntime(context, {
        taskId: task.id,
        expectedStateVersion: retried.task.stateVersion,
        action: "cancel",
        reason: "stop automation",
        actor: "operator"
      });
      return { paused, resumed, retried, canceled, events: listTaskEvents(context, task.id) };
    });

    expect(result.paused).toMatchObject({ previousStatus: "created", nextStatus: "paused" });
    expect(result.resumed).toMatchObject({ previousStatus: "paused", nextStatus: "resuming", dueAt: "2026-05-04T00:00:00.000Z" });
    expect(result.retried).toMatchObject({ nextStatus: "resuming", dueAt: "2026-05-04T00:01:05.000Z" });
    expect(result.canceled.task.status).toBe("canceled");
    expect(result.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "operator.task_paused",
        "operator.task_resumed",
        "operator.task_retry_requested",
        "operator.task_canceled"
      ])
    );
    expect(result.events.find((event) => event.type === "operator.task_canceled")?.payload).toMatchObject({
      action: "cancel",
      actor: "operator",
      previousStatus: "resuming",
      nextStatus: "canceled",
      expectedStateVersion: 3
    });
  });

  it("controlTaskRuntime 拒绝过期 version、terminal task 和等待人工 gate 的 retry", () => {
    const databasePath = createMigratedDatabase();

    expect(() =>
      withDatabase(databasePath, (context) => {
        const project = createProject(context, { id: "project-control-stale", name: "control stale" });
        const task = createTask(context, { id: "task-control-stale", projectId: project.id, title: "control stale" });
        controlTaskRuntime(context, {
          taskId: task.id,
          expectedStateVersion: task.stateVersion + 1,
          action: "pause"
        });
      })
    ).toThrow(ActiveResourceConflictError);

    expect(() =>
      withDatabase(databasePath, (context) => {
        const project = createProject(context, { id: "project-control-terminal", name: "control terminal" });
        const task = createTask(context, { id: "task-control-terminal", projectId: project.id, title: "control terminal" });
        context.db.prepare("UPDATE tasks SET status = ?, state_version = state_version + 1 WHERE id = ?").run("completed", task.id);
        controlTaskRuntime(context, {
          taskId: task.id,
          expectedStateVersion: task.stateVersion + 1,
          action: "retry"
        });
      })
    ).toThrow(ActiveResourceConflictError);

    expect(() =>
      withDatabase(databasePath, (context) => {
        const project = createProject(context, { id: "project-control-gate", name: "control gate" });
        const task = createTask(context, { id: "task-control-gate", projectId: project.id, title: "control gate" });
        context.db.prepare("UPDATE tasks SET status = ?, state_version = state_version + 1 WHERE id = ?").run("waiting_human", task.id);
        controlTaskRuntime(context, {
          taskId: task.id,
          expectedStateVersion: task.stateVersion + 1,
          action: "retry"
        });
      })
    ).toThrow(ActiveResourceConflictError);
  });

  it("recordHumanAnswerRuntime 写 artifact、更新 request 为 answered，并只唤醒 task", () => {
    const databasePath = createMigratedDatabase();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-operator-workspaces-"));

    const result = withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-answer",
        name: "answer",
        workspaceRoot
      });
      const task = createTask(context, { id: "task-answer", projectId: project.id, title: "answer" });
      const request = createHumanRequest(context, {
        id: "human-answer",
        projectId: project.id,
        taskId: task.id,
        blockedKey: "agent:requirements",
        kind: "requirements-clarification",
        status: "pending",
        questionArtifactPath: "human-question.md"
      });
      context.db
        .prepare("UPDATE tasks SET status = ?, state_version = state_version + 1 WHERE id = ?")
        .run("waiting_human", task.id);
      return recordHumanAnswerRuntime(context, {
        humanRequestId: request.id,
        expectedStateVersion: request.stateVersion,
        answer: "按方案 A 推进。",
        answeredBy: "operator"
      });
    });

    const artifactFullPath = join(workspaceRoot, "project-answer", "task-answer", "_task", "coordinator", "artifacts", result.artifactPath);
    expect(result.humanRequest).toMatchObject({
      status: "answered"
    });
    expect(result.artifactPath).toMatch(/^human-answers\/human-answer-v0-.+\.md$/);
    expect(existsSync(artifactFullPath)).toBe(true);
    expect(readFileSync(artifactFullPath, "utf8")).toContain("按方案 A 推进。");

    const post = withDatabase(databasePath, (context) => ({
      surface: buildTaskSurfaceFromDb(context, "task-answer"),
      events: listTaskEvents(context, "task-answer")
    }));
    expect(post.surface.surfaceKind).toBe("human_answered");
    expect(post.events.map((event) => event.type)).toContain("human.answer_received");
  });

  it("recordHumanAnswerRuntime 拒绝过期 version 或非 pending request", () => {
    const databasePath = createMigratedDatabase();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-operator-workspaces-"));

    expect(() =>
      withDatabase(databasePath, (context) => {
        const project = createProject(context, {
          id: "project-answer-stale",
          name: "answer stale",
          workspaceRoot
        });
        const task = createTask(context, { id: "task-answer-stale", projectId: project.id, title: "answer stale" });
        const request = createHumanRequest(context, {
          id: "human-answer-stale",
          projectId: project.id,
          taskId: task.id,
          blockedKey: "agent:requirements",
          kind: "requirements-clarification",
          status: "pending"
        });
        recordHumanAnswerRuntime(context, {
          humanRequestId: request.id,
          expectedStateVersion: request.stateVersion + 1,
          answer: "stale"
        });
      })
    ).toThrow(ActiveResourceConflictError);

    expect(() =>
      withDatabase(databasePath, (context) => {
        const project = createProject(context, {
          id: "project-answer-done",
          name: "answer done",
          workspaceRoot
        });
        const task = createTask(context, { id: "task-answer-done", projectId: project.id, title: "answer done" });
        const request = createHumanRequest(context, {
          id: "human-answer-done",
          projectId: project.id,
          taskId: task.id,
          blockedKey: "agent:requirements",
          kind: "requirements-clarification",
          status: "answered"
        });
        recordHumanAnswerRuntime(context, {
          humanRequestId: request.id,
          expectedStateVersion: request.stateVersion,
          answer: "done"
        });
      })
    ).toThrow(ActiveResourceConflictError);

    expect(() =>
      withDatabase(databasePath, (context) =>
        createManualTask(context, {
          projectId: "missing",
          title: "missing"
        })
      )
    ).toThrow(OperatorSurfaceError);
  });

  it("recordHumanAnswerRuntime 在事务失败时清理本次 answer artifact", () => {
    const databasePath = createMigratedDatabase();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-operator-workspaces-"));

    expect(() =>
      withDatabase(databasePath, (context) => {
        const project = createProject(context, {
          id: "project-answer-cleanup",
          name: "answer cleanup",
          workspaceRoot
        });
        const task = createTask(context, { id: "task-answer-cleanup", projectId: project.id, title: "answer cleanup" });
        const request = createHumanRequest(context, {
          id: "human-answer-cleanup",
          projectId: project.id,
          taskId: task.id,
          blockedKey: "agent:requirements",
          kind: "requirements-clarification",
          status: "pending"
        });
        // 用 trigger 模拟 artifact 写入后 DB 更新阶段失败，验证清理逻辑不会留下未引用文件。
        context.db.exec(`
          CREATE TRIGGER fail_human_answer_update
          BEFORE UPDATE ON human_requests
          WHEN NEW.status = 'answered'
          BEGIN
            SELECT RAISE(ABORT, 'forced answer failure');
          END;
        `);
        recordHumanAnswerRuntime(context, {
          humanRequestId: request.id,
          expectedStateVersion: request.stateVersion,
          answer: "cleanup"
        });
      })
    ).toThrow(/forced answer failure/);

    const artifactRoot = join(
      workspaceRoot,
      "project-answer-cleanup",
      "task-answer-cleanup",
      "_task",
      "coordinator",
      "artifacts",
      "human-answers"
    );
    expect(existsSync(artifactRoot) ? readdirSync(artifactRoot) : []).toEqual([]);
  });
});
