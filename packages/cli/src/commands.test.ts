import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProject, createTask, runMigrations, withDatabase } from "@coordinator/db";
import { runCli } from "./commands.js";

describe("runCli", () => {
  it("支持 health 命令", () => {
    const result = runCli(["health"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      service: "coordinator"
    });
  });

  it("支持 migrate 命令", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-cli-")), "cli.sqlite");
    const result = runCli(["migrate", "--db", databasePath]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      databasePath,
      applied: [
        { id: "0001_metadata.sql", applied: true },
        { id: "0002_core_data_model.sql", applied: true }
      ]
    });
  });

  it("显式传入 --db 时必须提供路径", () => {
    const result = runCli(["migrate", "--db"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("缺少 --db 参数值");
  });

  it("显式传入 --db 时不接受下一个 flag 作为路径", () => {
    const result = runCli(["migrate", "--db", "--other"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("缺少 --db 参数值");
  });

  it("支持 timeline 命令", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-cli-")), "timeline.sqlite");
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, { name: "coordinator" });
      createTask(context, { id: "task-timeline", projectId: project.id, title: "timeline" });
    });

    const result = runCli(["timeline", "--db", databasePath, "--task", "task-timeline"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      taskId: "task-timeline",
      events: [{ type: "task.created" }]
    });
  });
});
