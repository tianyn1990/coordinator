import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  ActiveResourceConflictError,
  CasConflictError,
  acquireLock,
  createOperation,
  createProject,
  createTask,
  listTaskEvents,
  releaseLock,
  runMigrations,
  updateTaskStatus,
  withDatabase
} from "./index.js";

function createMigratedDatabase(): string {
  const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-core-")), "core.sqlite");
  runMigrations(databasePath);
  return databasePath;
}

describe("core data model", () => {
  it("创建所有 P0 核心表", () => {
    const databasePath = createMigratedDatabase();
    const expectedTables = [
      "projects",
      "tasks",
      "attempts",
      "execution_plans",
      "plan_steps",
      "workspaces",
      "agent_sessions",
      "workflow_runs",
      "pull_requests",
      "human_requests",
      "events",
      "artifacts",
      "operations",
      "locks"
    ];

    const db = new DatabaseSync(databasePath);
    try {
      const rows = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      const names = new Set(rows.map((row) => row.name));
      for (const table of expectedTables) {
        expect(names.has(table)).toBe(true);
      }
    } finally {
      db.close();
    }
  });

  it("创建 task 时同事务写入 event", () => {
    const databasePath = createMigratedDatabase();

    const events = withDatabase(databasePath, (context) => {
      const project = createProject(context, { id: "project-1", name: "coordinator" });
      const task = createTask(context, { id: "task-1", projectId: project.id, title: "实现数据模型" });
      return listTaskEvents(context, task.id);
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "task.created",
      taskId: "task-1"
    });
  });

  it("使用过期 state_version 更新 task 会触发 CAS conflict", () => {
    const databasePath = createMigratedDatabase();

    expect(() =>
      withDatabase(databasePath, (context) => {
        const project = createProject(context, { name: "coordinator" });
        const task = createTask(context, { projectId: project.id, title: "CAS" });
        updateTaskStatus(context, task.id, task.stateVersion, "running");
        updateTaskStatus(context, task.id, task.stateVersion, "completed");
      })
    ).toThrow(CasConflictError);
  });

  it("events 是 append-only", () => {
    const databasePath = createMigratedDatabase();

    expect(() =>
      withDatabase(databasePath, (context) => {
        const project = createProject(context, { name: "coordinator" });
        const task = createTask(context, { projectId: project.id, title: "append-only" });
        const event = listTaskEvents(context, task.id)[0];
        context.db.prepare("UPDATE events SET summary = ? WHERE id = ?").run("mutated", event.id);
      })
    ).toThrow(/append-only/);
  });

  it("operation idempotency key 重复调用返回已有 operation", () => {
    const databasePath = createMigratedDatabase();

    const operations = withDatabase(databasePath, (context) => {
      const first = createOperation(context, { idempotencyKey: "workspace:create:attempt-1", kind: "workspace:create" });
      const second = createOperation(context, { idempotencyKey: "workspace:create:attempt-1", kind: "workspace:create" });
      return { first, second };
    });

    expect(operations.second.id).toBe(operations.first.id);
  });

  it("active workspace uniqueness 由数据库约束保障", () => {
    const databasePath = createMigratedDatabase();

    expect(() =>
      withDatabase(databasePath, (context) => {
        const project = createProject(context, { id: "project-active", name: "coordinator" });
        const task = createTask(context, { id: "task-active", projectId: project.id, title: "active workspace" });
        context.db
          .prepare("INSERT INTO attempts (id, project_id, task_id) VALUES (?, ?, ?)")
          .run("attempt-active", project.id, task.id);
        context.db
          .prepare("INSERT INTO workspaces (id, project_id, task_id, attempt_id, status) VALUES (?, ?, ?, ?, ?)")
          .run("workspace-1", project.id, task.id, "attempt-active", "ready");
        context.db
          .prepare("INSERT INTO workspaces (id, project_id, task_id, attempt_id, status) VALUES (?, ?, ?, ?, ?)")
          .run("workspace-2", project.id, task.id, "attempt-active", "creating");
      })
    ).toThrow(/constraint/);
  });

  it("active workflow run uniqueness 由数据库约束保障", () => {
    const databasePath = createMigratedDatabase();

    expect(() =>
      withDatabase(databasePath, (context) => {
        const { project, task, attemptId } = createAttemptFixture(context, "workflow");
        context.db
          .prepare(
            "INSERT INTO workflow_runs (id, project_id, task_id, attempt_id, profile_id, status) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .run("workflow-1", project.id, task.id, attemptId, "feature", "running");
        context.db
          .prepare(
            "INSERT INTO workflow_runs (id, project_id, task_id, attempt_id, profile_id, status) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .run("workflow-2", project.id, task.id, attemptId, "feature", "planned");
      })
    ).toThrow(/constraint/);
  });

  it("pending human request uniqueness 由数据库约束保障", () => {
    const databasePath = createMigratedDatabase();

    expect(() =>
      withDatabase(databasePath, (context) => {
        const { project, task, attemptId } = createAttemptFixture(context, "human");
        for (const id of ["human-1", "human-2"]) {
          context.db
            .prepare(
              `INSERT INTO human_requests (id, project_id, task_id, attempt_id, blocked_key, kind, status)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(id, project.id, task.id, attemptId, "gate:requirements", "clarification", "pending");
        }
      })
    ).toThrow(/constraint/);
  });

  it("active merge approval uniqueness 由 PR 维度数据库约束保障", () => {
    const databasePath = createMigratedDatabase();

    expect(() =>
      withDatabase(databasePath, (context) => {
        const { project, task, attemptId } = createAttemptFixture(context, "approval");
        context.db
          .prepare(
            `INSERT INTO pull_requests (id, project_id, task_id, attempt_id, provider_kind, status)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run("pr-approval", project.id, task.id, attemptId, "github", "open");
        for (const id of ["approval-1", "approval-2"]) {
          context.db
            .prepare(
              `INSERT INTO human_requests (id, project_id, task_id, attempt_id, pr_id, blocked_key, kind, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(id, project.id, task.id, attemptId, "pr-approval", `merge:${id}`, "merge_approval", "approved");
        }
      })
    ).toThrow(/constraint/);
  });

  it("active merge operation uniqueness 由 PR 维度数据库约束保障", () => {
    const databasePath = createMigratedDatabase();

    expect(() =>
      withDatabase(databasePath, (context) => {
        const { project, task, attemptId } = createAttemptFixture(context, "merge");
        context.db
          .prepare(
            `INSERT INTO pull_requests (id, project_id, task_id, attempt_id, provider_kind, status)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run("pr-merge", project.id, task.id, attemptId, "github", "open");
        createOperation(context, {
          idempotencyKey: "merge:pr-merge:head-a",
          kind: "merge",
          projectId: project.id,
          taskId: task.id,
          attemptId,
          prId: "pr-merge"
        });
        createOperation(context, {
          idempotencyKey: "merge:pr-merge:head-b",
          kind: "merge",
          projectId: project.id,
          taskId: task.id,
          attemptId,
          prId: "pr-merge"
        });
      })
    ).toThrow(/constraint/);
  });

  it("merge operation 必须携带 prId", () => {
    const databasePath = createMigratedDatabase();

    expect(() =>
      withDatabase(databasePath, (context) => {
        createOperation(context, { idempotencyKey: "merge:missing-pr", kind: "merge" });
      })
    ).toThrow(/requires prId/);
  });

  it("lock 支持未过期拒绝、释放和过期接管", () => {
    const databasePath = createMigratedDatabase();
    const baseTime = new Date("2026-05-03T00:00:00.000Z");

    withDatabase(databasePath, (context) => {
      const first = acquireLock(context, {
        resourceKind: "task",
        resourceId: "task-1",
        owner: "owner-1",
        ttlMs: 1000,
        now: baseTime
      });

      expect(() =>
        acquireLock(context, {
          resourceKind: "task",
          resourceId: "task-1",
          owner: "owner-2",
          ttlMs: 1000,
          now: new Date("2026-05-03T00:00:00.500Z")
        })
      ).toThrow(ActiveResourceConflictError);

      expect(releaseLock(context, "task", "task-1", "wrong-token")).toBe(false);
      expect(releaseLock(context, "task", "task-1", first.lockToken)).toBe(true);

      const reacquired = acquireLock(context, {
        resourceKind: "task",
        resourceId: "task-1",
        owner: "owner-2",
        ttlMs: 1000,
        now: baseTime
      });
      expect(reacquired.leaseVersion).toBe(1);

      const expired = acquireLock(context, {
        resourceKind: "task",
        resourceId: "task-1",
        owner: "owner-3",
        ttlMs: 1000,
        now: new Date("2026-05-03T00:00:02.000Z")
      });
      expect(expired.owner).toBe("owner-3");
      expect(expired.leaseVersion).toBe(2);
    });
  });
});

function createAttemptFixture(context: Parameters<typeof createProject>[0], suffix: string) {
  const project = createProject(context, { id: `project-${suffix}`, name: "coordinator" });
  const task = createTask(context, { id: `task-${suffix}`, projectId: project.id, title: suffix });
  const attemptId = `attempt-${suffix}`;
  context.db.prepare("INSERT INTO attempts (id, project_id, task_id) VALUES (?, ?, ?)").run(attemptId, project.id, task.id);
  return { project, task, attemptId };
}
