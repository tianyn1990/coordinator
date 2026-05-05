import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  ActiveResourceConflictError,
  CasConflictError,
  acquireLock,
  assertLockHeld,
  createOperation,
  createAgentSession,
  createArtifact,
  createAttempt,
  createProject,
  createTask,
  createWorkspace,
  getActiveAgentSessionByTask,
  getActiveWorkspaceByAttempt,
  getAgentSession,
  getLock,
  listTaskEvents,
  releaseLock,
  releaseLockIfVersion,
  runMigrations,
  updateAgentSession,
  updateOperation,
  updateWorkspace,
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

  it("operation 可记录运行状态和 observed state", () => {
    const databasePath = createMigratedDatabase();

    const operation = withDatabase(databasePath, (context) => {
      const created = createOperation(context, { idempotencyKey: "workspace:create:attempt-op", kind: "workspace:create" });
      updateOperation(context, {
        operationId: created.id,
        status: "running",
        lastObservedState: { phase: "start" }
      });
      return updateOperation(context, {
        operationId: created.id,
        status: "succeeded",
        lastObservedState: { phase: "done" }
      });
    });

    expect(operation).toMatchObject({
      status: "succeeded",
      lastObservedState: { phase: "done" }
    });
  });

  it("operation terminal status 不允许被回退", () => {
    const databasePath = createMigratedDatabase();

    expect(() =>
      withDatabase(databasePath, (context) => {
        const created = createOperation(context, { idempotencyKey: "workspace:create:terminal", kind: "workspace:create" });
        updateOperation(context, { operationId: created.id, status: "succeeded" });
        updateOperation(context, { operationId: created.id, status: "running" });
      })
    ).toThrow(ActiveResourceConflictError);
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

  it("attempt/workspace repository 可创建并查询 active workspace", () => {
    const databasePath = createMigratedDatabase();

    const result = withDatabase(databasePath, (context) => {
      const project = createProject(context, { id: "project-workspace", name: "coordinator" });
      const task = createTask(context, { id: "task-workspace", projectId: project.id, title: "workspace" });
      const attempt = createAttempt(context, { id: "attempt-workspace", projectId: project.id, taskId: task.id });
      const workspace = createWorkspace(context, {
        id: "workspace-workspace",
        projectId: project.id,
        taskId: task.id,
        attemptId: attempt.id,
        status: "creating",
        branch: "coordinator/task-workspace/attempt-workspace",
        baseBranch: "main"
      });
      const ready = updateWorkspace(context, {
        workspaceId: workspace.id,
        expectedStateVersion: workspace.stateVersion,
        status: "ready",
        workspacePath: "/tmp/workspace",
        repoPath: "/tmp/workspace/repo",
        branch: workspace.branch,
        baseBranch: workspace.baseBranch
      });
      return {
        ready,
        active: getActiveWorkspaceByAttempt(context, attempt.id),
        events: listTaskEvents(context, task.id)
      };
    });

    expect(result.ready).toMatchObject({
      id: "workspace-workspace",
      status: "ready",
      repoPath: "/tmp/workspace/repo"
    });
    expect(result.active?.id).toBe("workspace-workspace");
    expect(result.events.map((event) => event.type)).toContain("workspace.created");
  });

  it("workspace update 使用过期 state_version 会触发 CAS conflict", () => {
    const databasePath = createMigratedDatabase();

    expect(() =>
      withDatabase(databasePath, (context) => {
        const { project, task, attemptId } = createAttemptFixture(context, "workspace-cas");
        const workspace = createWorkspace(context, {
          projectId: project.id,
          taskId: task.id,
          attemptId
        });
        updateWorkspace(context, {
          workspaceId: workspace.id,
          expectedStateVersion: workspace.stateVersion,
          status: "creating"
        });
        updateWorkspace(context, {
          workspaceId: workspace.id,
          expectedStateVersion: workspace.stateVersion,
          status: "ready"
        });
      })
    ).toThrow(CasConflictError);
  });

  it("artifact repository 可登记 checkpoint artifact", () => {
    const databasePath = createMigratedDatabase();

    const artifact = withDatabase(databasePath, (context) => {
      const { project, task, attemptId } = createAttemptFixture(context, "artifact");
      return createArtifact(context, {
        id: "artifact-checkpoint",
        projectId: project.id,
        taskId: task.id,
        attemptId,
        kind: "checkpoint",
        owner: "workspace-manager",
        path: "checkpoint.md"
      });
    });

    expect(artifact).toMatchObject({
      id: "artifact-checkpoint",
      kind: "checkpoint",
      owner: "workspace-manager",
      path: "checkpoint.md"
    });
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

  it("agent session repository 可创建、更新和查询 active outer session", () => {
    const databasePath = createMigratedDatabase();

    const result = withDatabase(databasePath, (context) => {
      const { project, task } = createAttemptFixture(context, "agent-session");
      const session = createAgentSession(context, {
        id: "agent-session-1",
        projectId: project.id,
        taskId: task.id,
        providerKind: "fake",
        role: "outer",
        status: "starting",
        promptPath: "/tmp/session/prompt.md",
        surfaceJsonPath: "/tmp/session/surface.json",
        surfaceMarkdownPath: "/tmp/session/surface.md",
        transcriptPath: "/tmp/session/transcript.jsonl"
      });
      const running = updateAgentSession(context, {
        agentSessionId: session.id,
        expectedStateVersion: session.stateVersion,
        status: "running"
      });
      return {
        running,
        active: getActiveAgentSessionByTask(context, task.id),
        loaded: getAgentSession(context, session.id),
        events: listTaskEvents(context, task.id)
      };
    });

    expect(result.running).toMatchObject({
      id: "agent-session-1",
      status: "running",
      promptPath: "/tmp/session/prompt.md"
    });
    expect(result.active?.id).toBe("agent-session-1");
    expect(result.loaded?.transcriptPath).toBe("/tmp/session/transcript.jsonl");
    expect(result.events.map((event) => event.type)).toContain("agent.session_created");
  });

  it("同一 task 只能有一个 active outer agent session", () => {
    const databasePath = createMigratedDatabase();

    expect(() =>
      withDatabase(databasePath, (context) => {
        const { project, task } = createAttemptFixture(context, "agent-active");
        for (const id of ["agent-active-1", "agent-active-2"]) {
          createAgentSession(context, {
            id,
            projectId: project.id,
            taskId: task.id,
            providerKind: "fake",
            role: "outer",
            status: "running"
          });
        }
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

  it("assertLockHeld 拒绝过期或错误 token", () => {
    const databasePath = createMigratedDatabase();
    const baseTime = new Date("2026-05-03T00:00:00.000Z");

    withDatabase(databasePath, (context) => {
      const lock = acquireLock(context, {
        resourceKind: "workspace",
        resourceId: "workspace-1",
        owner: "owner-1",
        ttlMs: 1000,
        now: baseTime
      });

      expect(() => assertLockHeld(context, "workspace", "workspace-1", lock.lockToken, baseTime)).not.toThrow();
      expect(() => assertLockHeld(context, "workspace", "workspace-1", "wrong-token", baseTime)).toThrow(
        ActiveResourceConflictError
      );
      expect(() =>
        assertLockHeld(context, "workspace", "workspace-1", lock.lockToken, new Date("2026-05-03T00:00:02.000Z"))
      ).toThrow(ActiveResourceConflictError);
    });
  });

  it("releaseLockIfVersion 使用 lock token 和 leaseVersion 做 fencing", () => {
    const databasePath = createMigratedDatabase();
    const baseTime = new Date("2026-05-03T00:00:00.000Z");

    withDatabase(databasePath, (context) => {
      const first = acquireLock(context, {
        resourceKind: "workspace",
        resourceId: "workspace-fencing",
        owner: "owner-1",
        ttlMs: 1000,
        now: baseTime
      });
      const second = acquireLock(context, {
        resourceKind: "workspace",
        resourceId: "workspace-fencing",
        owner: "owner-2",
        ttlMs: 1000,
        now: new Date("2026-05-03T00:00:02.000Z")
      });

      expect(releaseLockIfVersion(context, {
        resourceKind: "workspace",
        resourceId: "workspace-fencing",
        lockToken: first.lockToken,
        leaseVersion: first.leaseVersion
      })).toBe(false);
      expect(getLock(context, "workspace", "workspace-fencing")).toMatchObject({
        owner: "owner-2",
        leaseVersion: second.leaseVersion
      });
      expect(releaseLockIfVersion(context, {
        resourceKind: "workspace",
        resourceId: "workspace-fencing",
        lockToken: second.lockToken,
        leaseVersion: second.leaseVersion
      })).toBe(true);
      expect(getLock(context, "workspace", "workspace-fencing")).toBeUndefined();
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
