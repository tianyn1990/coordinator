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
        { id: "0002_core_data_model.sql", applied: true },
        { id: "0003_project_registry.sql", applied: true }
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

  it("register 命令要求显式传入 db", () => {
    const result = runCli(["register", "--repo", "/tmp/repo"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("缺少 --db 参数");
  });

  it("register 命令拒绝非法 provider", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-cli-registry-")), "registry.sqlite");
    runMigrations(databasePath);

    const result = runCli(["register", "--db", databasePath, "--repo", "/tmp/repo", "--provider", "bitbucket"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("不支持的 provider");
  });

  it("register 命令拒绝缺少 provider 参数值", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-cli-registry-")), "registry.sqlite");
    runMigrations(databasePath);

    const result = runCli(["register", "--db", databasePath, "--repo", "/tmp/repo", "--provider"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("缺少 --provider 参数值");
  });

  it("支持 projects 命令查看 registry", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-cli-registry-")), "registry.sqlite");
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      createProject(context, { id: "project-cli", name: "coordinator", defaultBranch: "main" });
    });

    const result = runCli(["projects", "--db", databasePath]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      projects: [{ id: "project-cli", defaultBranch: "main" }]
    });
  });

  it("支持 surface 命令查看 JSON surface", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-cli-surface-")), "surface.sqlite");
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-cli-surface",
        name: "coordinator",
        defaultBranch: "main",
        workflowLauncher: "workflow"
      });
      createTask(context, {
        id: "task-cli-surface",
        projectId: project.id,
        title: "surface",
        description: "surface",
        autonomy: "balanced"
      });
    });

    const result = runCli(["surface", "--db", databasePath, "--task", "task-cli-surface"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      surface_kind: "bootstrap",
      available_tools: [{ name: "write_execution_plan" }, { name: "ask_human" }]
    });
  });

  it("支持 surface 命令查看 Markdown surface", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-cli-surface-")), "surface.sqlite");
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-cli-surface-md",
        name: "coordinator",
        defaultBranch: "main"
      });
      createTask(context, {
        id: "task-cli-surface-md",
        projectId: project.id,
        title: "surface md",
        description: "surface",
        autonomy: "conservative"
      });
    });

    const result = runCli(["surface", "--db", databasePath, "--task", "task-cli-surface-md", "--format", "markdown"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("# Coordinator Surface");
    expect(result.stdout).toContain("当前自主级别：conservative。");
  });

  it("workspace create 要求 attempt 参数", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-cli-workspace-")), "workspace.sqlite");
    runMigrations(databasePath);

    const result = runCli(["workspace", "create", "--db", databasePath]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("缺少 --attempt 参数");
  });

  it("workspace preflight 可报告缺失 workspace record", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-cli-workspace-")), "workspace.sqlite");
    runMigrations(databasePath);

    const result = runCli(["workspace", "preflight", "--db", databasePath, "--workspace", "missing-workspace"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "retryable",
      checks: [{ name: "workspace-record" }]
    });
  });
});
