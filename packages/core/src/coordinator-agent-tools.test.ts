import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createAttempt,
  createProject,
  createTask,
  createWorkspace,
  listTaskEvents,
  runMigrations,
  withDatabase,
  type DbContext
} from "@coordinator/db";
import {
  CoordinatorAgentToolError,
  buildTaskSurfaceFromDb,
  executeCoordinatorAgentTool,
  type WorkflowProtocolRunner
} from "./index.js";

function createMigratedDatabase(): string {
  const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-agent-tools-db-")), "tools.sqlite");
  runMigrations(databasePath);
  return databasePath;
}

function createTaskFixture(databasePath: string) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-agent-tools-workspaces-"));
  const ids = withDatabase(databasePath, (context) => {
    const project = createProject(context, {
      id: "project-tools",
      name: "tools",
      workspaceRoot,
      defaultBranch: "main",
      workflowLauncher: "workflow"
    });
    const task = createTask(context, {
      id: "task-tools",
      projectId: project.id,
      title: "tools",
      description: "tool executor"
    });
    return { projectId: project.id, taskId: task.id };
  });
  return { ...ids, workspaceRoot };
}

function writeTaskArtifact(workspaceRoot: string, relativePath: string, content: string): string {
  const artifactRoot = join(workspaceRoot, "project-tools", "task-tools", "_task", "coordinator", "artifacts");
  const dirname = relativePath.split("/").slice(0, -1).join("/");
  mkdirSync(dirname ? join(artifactRoot, dirname) : artifactRoot, { recursive: true });
  writeFileSync(join(artifactRoot, relativePath), content);
  return artifactRoot;
}

describe("coordinator agent tools executor", () => {
  it("拒绝当前 surface 不可见的工具，并记录失败 tool event", () => {
    const databasePath = createMigratedDatabase();
    createTaskFixture(databasePath);

    expect(() =>
      withDatabase(databasePath, (context) =>
        executeCoordinatorAgentTool(context, {
          taskId: "task-tools",
          toolName: "start_workflow_run",
          args: { profile: "feature" }
        })
      )
    ).toThrow(CoordinatorAgentToolError);

    const events = withDatabase(databasePath, (context) => listTaskEvents(context, "task-tools"));
    expect(events.at(-1)).toMatchObject({
      type: "agent_tool_call",
      severity: "warn"
    });
    expect(events.at(-1)?.payload).toMatchObject({
      toolName: "start_workflow_run",
      status: "failed",
      failureCode: "not_allowed_in_current_state"
    });
  });

  it("write_execution_plan 通过 task-local artifact 写入计划，并让下一次 surface 暴露 create_attempt", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    writeTaskArtifact(fixture.workspaceRoot, "execution-plan.md", "# Plan\n\n1. create attempt\n");

    const result = withDatabase(databasePath, (context) =>
      executeCoordinatorAgentTool(context, {
        taskId: "task-tools",
        toolName: "write_execution_plan",
        actor: "test-agent",
        args: { artifact: "execution-plan.md" }
      })
    );

    expect(result).toMatchObject({
      toolName: "write_execution_plan",
      status: "succeeded",
      artifactRefs: ["execution-plan.md"]
    });

    const surface = withDatabase(databasePath, (context) => buildTaskSurfaceFromDb(context, "task-tools"));
    expect(surface.json.execution_plan).toMatchObject({ artifact_path: "execution-plan.md", status: "active" });
    expect(surface.json.available_tools.map((tool) => tool.name)).toEqual([
      "create_attempt",
      "revise_execution_plan",
      "ask_human"
    ]);
  });

  it("artifact path 拒绝绝对路径和 .. segment", () => {
    const databasePath = createMigratedDatabase();
    createTaskFixture(databasePath);

    expect(() =>
      withDatabase(databasePath, (context) =>
        executeCoordinatorAgentTool(context, {
          taskId: "task-tools",
          toolName: "write_execution_plan",
          args: { artifact: "../execution-plan.md" }
        })
      )
    ).toThrow(/artifact path/);
  });

  it("ask_human 创建 pending human request，并在无 workflow run 时不暴露工具", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    writeTaskArtifact(fixture.workspaceRoot, "human-question.md", "需要确认范围。");

    const result = withDatabase(databasePath, (context) =>
      executeCoordinatorAgentTool(context, {
        taskId: "task-tools",
        toolName: "ask_human",
        args: { kind: "requirements-clarification", artifact: "human-question.md" }
      })
    );

    expect(result).toMatchObject({
      toolName: "ask_human",
      status: "succeeded"
    });

    const surface = withDatabase(databasePath, (context) => buildTaskSurfaceFromDb(context, "task-tools"));
    expect(surface.surfaceKind).toBe("human_waiting");
    expect(surface.json.human_requests[0]).toMatchObject({
      kind: "requirements-clarification",
      status: "pending",
      question_artifact_path: "human-question.md"
    });
    expect(surface.json.available_tools.map((tool) => tool.name)).toEqual([]);
  });

  it("create_workspace 返回 sanitized result，不暴露 lockToken 或绝对 manifest path", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const repoPath = mkdtempSync(join(tmpdir(), "coordinator-agent-tools-repo-"));
    mkdirSync(join(repoPath, ".git"));
    const result = withDatabase(databasePath, (context) => {
      context.db.prepare("UPDATE projects SET repo_path = ?, default_branch = ? WHERE id = ?").run(repoPath, "main", fixture.projectId);
      const task = createTask(context, { id: "task-workspace", projectId: fixture.projectId, title: "workspace" });
      createExecutionPlanForTest(context, fixture.projectId, task.id);
      const attempt = createAttempt(context, { projectId: fixture.projectId, taskId: task.id });
      return executeCoordinatorAgentTool(context, {
        taskId: task.id,
        toolName: "create_workspace",
        args: { attempt: attempt.id },
        workspace: {
          gitRunner: (args) => {
            if (args[0] === "rev-parse" && args[1] === "--verify") throw new Error("branch missing");
            if (args[0] === "worktree" && args[1] === "add") {
              mkdirSync(args[2], { recursive: true });
              mkdirSync(join(args[2], ".git"));
              return "";
            }
            if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return "true\n";
            if (args[0] === "branch") return `coordinator/${task.id}/${attempt.id}\n`;
            if (args[0] === "status") return "";
            return "";
          }
        }
      });
    });

    expect(result.result).toMatchObject({ kind: "workspace", status: "ready" });
    expect(JSON.stringify(result.result)).not.toContain("lockToken");
    expect(JSON.stringify(result.result)).not.toContain("ownership");
  });

  it("inspect_workflow_run 返回 sanitized result，不暴露 workflow debug 字段", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const workspacePath = mkdtempSync(join(tmpdir(), "coordinator-agent-tools-wf-workspace-"));
    const repoPath = join(workspacePath, "repo");
    mkdirSync(join(repoPath, ".git"), { recursive: true });
    const runner: WorkflowProtocolRunner = () =>
      JSON.stringify({
        runId: "inner-run-1",
        lifecycle: "active",
        stage: "review",
        substate: "debug-only",
        allowedActions: ["debug-only"],
        handoff: { available: false, artifacts: [], deniedActions: [] },
        summary: "running"
      });

    const result = withDatabase(databasePath, (context) => {
      const task = createTask(context, { id: "task-wf-inspect", projectId: fixture.projectId, title: "wf" });
      createExecutionPlanForTest(context, fixture.projectId, task.id);
      const attempt = createAttempt(context, { id: "attempt-wf-inspect", projectId: fixture.projectId, taskId: task.id });
      createWorkspace(context, {
        projectId: fixture.projectId,
        taskId: task.id,
        attemptId: attempt.id,
        status: "ready",
        workspacePath,
        repoPath,
        branch: "coordinator/task-wf-inspect/attempt-wf-inspect",
        baseBranch: "main"
      });
      const run = context.db
        .prepare(
          `INSERT INTO workflow_runs (id, project_id, task_id, attempt_id, profile_id, status, external_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("workflow-run-inspect", fixture.projectId, task.id, attempt.id, "feature", "running", "inner-run-1");
      expect(run.changes).toBe(1);
      return executeCoordinatorAgentTool(context, {
        taskId: task.id,
        toolName: "inspect_workflow_run",
        args: { run: "workflow-run-inspect" },
        workflowInspect: { runner }
      });
    });

    expect(result.result).toMatchObject({ kind: "workflow_run", id: "workflow-run-inspect", status: "running" });
    expect(JSON.stringify(result.result)).not.toContain("debug-only");
    expect(JSON.stringify(result.result)).not.toContain("allowedActions");
  });
});

function createExecutionPlanForTest(context: DbContext, projectId: string, taskId: string): void {
  context.db
    .prepare("INSERT INTO execution_plans (id, project_id, task_id, status, artifact_path) VALUES (?, ?, ?, ?, ?)")
    .run(`plan-${taskId}`, projectId, taskId, "active", "execution-plan.md");
}
