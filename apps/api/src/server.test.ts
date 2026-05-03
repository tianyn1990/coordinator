import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHumanRequest, createProject, createTask, runMigrations, withDatabase } from "@coordinator/db";
import { buildServer } from "./server.js";

describe("API health", () => {
  it("返回 coordinator 健康状态", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      service: "coordinator"
    });
  });

  it("支持 Web operator surface 的 CORS preflight", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "OPTIONS",
      url: "/tasks",
      headers: { origin: "http://127.0.0.1:5173" }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
  });

  it("按 task id 返回 event timeline", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-")), "api.sqlite");
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, { name: "coordinator" });
      createTask(context, { id: "task-api-timeline", projectId: project.id, title: "api timeline" });
    });

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({ method: "GET", url: "/tasks/task-api-timeline/timeline" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        taskId: "task-api-timeline",
        events: [{ type: "task.created" }]
      });
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("可以查看 project registry", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-projects-")), "api.sqlite");
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      createProject(context, {
        id: "project-api",
        name: "coordinator",
        defaultBranch: "main",
        workflowLauncher: "workflow"
      });
    });

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({ method: "GET", url: "/projects" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        projects: [{ id: "project-api", defaultBranch: "main" }]
      });
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("Web API 可创建 manual task 并查看 task list/detail", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-web-task-")), "api.sqlite");
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      createProject(context, {
        id: "project-api-web",
        name: "web",
        workspaceRoot: mkdtempSync(join(tmpdir(), "coordinator-api-web-workspaces-"))
      });
    });

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const created = await server.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          projectId: "project-api-web",
          title: "Web manual task",
          description: "from UI",
          autonomy: "balanced"
        }
      });
      expect(created.statusCode).toBe(200);
      expect(created.json()).toMatchObject({
        task: { sourceKind: "manual", title: "Web manual task" }
      });

      const listed = await server.inject({ method: "GET", url: "/tasks" });
      expect(listed.statusCode).toBe(200);
      expect(listed.json()).toMatchObject({
        tasks: [{ title: "Web manual task", projectName: "web" }]
      });

      const detail = await server.inject({ method: "GET", url: `/tasks/${created.json().task.id}` });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({
        task: { title: "Web manual task" },
        surface: {
          json: {
            available_tools: [{ name: "write_execution_plan" }, { name: "ask_human" }]
          }
        }
      });
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("Web API 可回答 human request，并把正文写入 artifact", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-human-answer-")), "api.sqlite");
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-api-human-workspaces-"));
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-api-human",
        name: "human",
        workspaceRoot
      });
      const task = createTask(context, { id: "task-api-human", projectId: project.id, title: "human" });
      createHumanRequest(context, {
        id: "human-api-answer",
        projectId: project.id,
        taskId: task.id,
        blockedKey: "agent:requirements",
        kind: "requirements-clarification",
        status: "pending"
      });
      context.db
        .prepare("UPDATE tasks SET status = ?, state_version = state_version + 1 WHERE id = ?")
        .run("waiting_human", task.id);
    });

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({
        method: "POST",
        url: "/human-requests/human-api-answer/answer",
        payload: {
          expectedStateVersion: 0,
          answer: "继续执行。",
          answeredBy: "api-test"
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { humanRequest: { status: string }; artifactPath: string };
      expect(body.humanRequest).toMatchObject({ status: "answered" });
      expect(body.artifactPath).toMatch(/^human-answers\/human-api-answer-v0-.+\.md$/);
      expect(
        existsSync(
          join(
            workspaceRoot,
            "project-api-human",
            "task-api-human",
            "_task",
            "coordinator",
            "artifacts",
            body.artifactPath
          )
        )
      ).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("注册 API 拒绝非法 providerOverride", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-register-")), "api.sqlite");
    runMigrations(databasePath);

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({
        method: "POST",
        url: "/projects/register",
        payload: {
          repoPath: "/tmp/repo",
          providerOverride: "bitbucket",
          confirmedDefaultBranch: "main"
        }
      });

      expect(response.statusCode).toBe(400);
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("可以查看 task surface", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-surface-")), "api.sqlite");
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-surface-api",
        name: "coordinator",
        defaultBranch: "main",
        workflowLauncher: "workflow"
      });
      createTask(context, {
        id: "task-surface-api",
        projectId: project.id,
        title: "surface api",
        description: "surface",
        autonomy: "balanced"
      });
    });

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({ method: "GET", url: "/tasks/task-surface-api/surface" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        surfaceKind: "bootstrap",
        json: {
          surface_kind: "bootstrap",
          available_tools: [{ name: "write_execution_plan" }, { name: "ask_human" }]
        }
      });
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("workspace preflight API 可报告缺失 workspace record", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-workspace-")), "api.sqlite");
    runMigrations(databasePath);

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({ method: "GET", url: "/workspaces/missing-workspace/preflight" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: "retryable",
        checks: [{ name: "workspace-record" }]
      });
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("workspace create API 缺少 attempt 时返回受控错误", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-workspace-")), "api.sqlite");
    runMigrations(databasePath);

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({
        method: "POST",
        url: "/attempts/missing-attempt/workspace",
        payload: { owner: "api-test" }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: "attempt not found: missing-attempt" });
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("agent session API 可通过 fake provider 启动并查询", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-agent-")), "api.sqlite");
    const repoPath = mkdtempSync(join(tmpdir(), "coordinator-api-agent-repo-"));
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-api-agent-workspaces-"));
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-api-agent",
        name: "agent",
        repoPath,
        workspaceRoot,
        outerAgentDefaultProvider: "fake"
      });
      createTask(context, { id: "task-api-agent", projectId: project.id, title: "agent api" });
    });

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const created = await server.inject({
        method: "POST",
        url: "/tasks/task-api-agent/agent-sessions",
        payload: { providerId: "fake" }
      });

      expect(created.statusCode).toBe(200);
      const body = created.json();
      expect(body.session).toMatchObject({ taskId: "task-api-agent", providerKind: "fake", status: "completed" });

      const inspected = await server.inject({ method: "GET", url: `/agent-sessions/${body.session.id}` });
      expect(inspected.statusCode).toBe(200);
      expect(inspected.json()).toMatchObject({
        session: { id: body.session.id },
        artifacts: { finalResponsePath: body.artifacts.finalResponsePath }
      });
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("agent tools API 是 operator 调试入口，可执行 write_execution_plan", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-tools-")), "tools.sqlite");
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-api-tools-workspaces-"));
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-api-tools",
        name: "tools",
        workspaceRoot
      });
      createTask(context, { id: "task-api-tools", projectId: project.id, title: "tools api" });
    });
    const artifactRoot = join(workspaceRoot, "project-api-tools", "task-api-tools", "_task", "coordinator", "artifacts");
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(join(artifactRoot, "execution-plan.md"), "# Plan\n");

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({
        method: "POST",
        url: "/tasks/task-api-tools/agent-tools",
        payload: {
          toolName: "write_execution_plan",
          args: { artifact: "execution-plan.md" }
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        toolName: "write_execution_plan",
        status: "succeeded"
      });

      const surface = await server.inject({ method: "GET", url: "/tasks/task-api-tools/surface" });
      expect(surface.json().json.available_tools.map((tool: { name: string }) => tool.name)).not.toContain("agent-tool execute");
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("daemon tick API 是 operator 调试入口，不进入 Coordinator Surface", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-daemon-")), "daemon.sqlite");
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-api-daemon-workspaces-"));
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-api-daemon",
        name: "daemon",
        workspaceRoot,
        outerAgentDefaultProvider: "fake"
      });
      createTask(context, { id: "task-api-daemon", projectId: project.id, title: "daemon api" });
    });

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({
        method: "POST",
        url: "/daemon/tick",
        payload: { owner: "api-test" }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: "acted",
        actions: expect.arrayContaining([expect.objectContaining({ kind: "agent_tool_skipped" })])
      });

      const surface = await server.inject({ method: "GET", url: "/tasks/task-api-daemon/surface" });
      expect(surface.json().json.available_tools.map((tool: { name: string }) => tool.name)).not.toContain("daemon tick");
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });

  it("PR/MR API 入口存在且是 operator-only", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-api-pr-")), "pr.sqlite");
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-api-pr",
        name: "pr",
        repoPath: mkdtempSync(join(tmpdir(), "coordinator-api-pr-repo-")),
        defaultBranch: "main",
        prProviderKind: "github"
      });
      createTask(context, { id: "task-api-pr", projectId: project.id, title: "pr api" });
    });

    const previous = process.env.COORDINATOR_DB_PATH;
    process.env.COORDINATOR_DB_PATH = databasePath;
    try {
      const server = buildServer();
      const response = await server.inject({
        method: "POST",
        url: "/tasks/task-api-pr/pull-requests",
        payload: {
          title: "PR",
          bodyArtifact: "body.md"
        }
      });

      expect(response.statusCode).toBe(400);
    } finally {
      if (previous === undefined) {
        delete process.env.COORDINATOR_DB_PATH;
      } else {
        process.env.COORDINATOR_DB_PATH = previous;
      }
    }
  });
});
