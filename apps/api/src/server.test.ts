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
});
