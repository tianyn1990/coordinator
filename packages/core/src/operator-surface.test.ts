import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ActiveResourceConflictError,
  createAttempt,
  createHumanRequest,
  createProject,
  createPullRequest,
  createTask,
  createWorkspace,
  listTaskEvents,
  runMigrations,
  withDatabase
} from "@coordinator/db";
import {
  OperatorSurfaceError,
  buildTaskSurfaceFromDb,
  createManualTask,
  getOperatorTaskDetail,
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
