import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, createTask, runMigrations, withDatabase } from "@coordinator/db";
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
});
