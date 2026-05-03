import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
        { id: "0003_project_registry.sql", applied: true },
        { id: "0004_workflow_protocol_adapter.sql", applied: true },
        { id: "0005_agent_provider_runtime.sql", applied: true },
        { id: "0006_pr_mr_provider.sql", applied: true }
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

  it("workflow capabilities 要求 project 参数", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-cli-workflow-")), "workflow.sqlite");
    runMigrations(databasePath);

    const result = runCli(["workflow", "capabilities", "--db", databasePath]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("缺少 --project 参数");
  });

  it("workflow action 要求 expected version 参数", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-cli-workflow-")), "workflow.sqlite");
    runMigrations(databasePath);

    const result = runCli(["workflow", "action", "--db", databasePath, "--run", "run-1", "--action", "continue"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("缺少 --expected-version 参数");
  });

  it("agent run 可通过 fake provider 启动一次 outer session", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-cli-agent-")), "agent.sqlite");
    const repoPath = mkdtempSync(join(tmpdir(), "coordinator-cli-agent-repo-"));
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-cli-agent-workspaces-"));
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-cli-agent",
        name: "agent",
        repoPath,
        workspaceRoot,
        outerAgentDefaultProvider: "fake"
      });
      createTask(context, { id: "task-cli-agent", projectId: project.id, title: "agent" });
    });

    const result = runCli(["agent", "run", "--db", databasePath, "--task", "task-cli-agent", "--provider", "fake"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      session: {
        taskId: "task-cli-agent",
        providerKind: "fake",
        status: "completed"
      }
    });
  });

  it("agent inspect 要求 session 参数", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-cli-agent-")), "agent.sqlite");
    runMigrations(databasePath);

    const result = runCli(["agent", "inspect", "--db", databasePath]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("缺少 --session 参数");
  });

  it("agent-tool execute 可通过窄参数调用 write_execution_plan", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-cli-tools-workspaces-"));
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-cli-tools-")), "tools.sqlite");
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-cli-tools",
        name: "tools",
        workspaceRoot
      });
      createTask(context, { id: "task-cli-tools", projectId: project.id, title: "tools" });
    });
    const artifactRoot = join(workspaceRoot, "project-cli-tools", "task-cli-tools", "_task", "coordinator", "artifacts");
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(join(artifactRoot, "execution-plan.md"), "# Plan\n");

    const result = runCli([
      "agent-tool",
      "execute",
      "--db",
      databasePath,
      "--task",
      "task-cli-tools",
      "--tool",
      "write_execution_plan",
      "--arg-artifact",
      "execution-plan.md"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      toolName: "write_execution_plan",
      status: "succeeded"
    });
  });

  it("daemon tick 命令可执行一次最小调度，入口保持 operator-only", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-cli-daemon-workspaces-"));
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-cli-daemon-")), "daemon.sqlite");
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-cli-daemon",
        name: "daemon",
        workspaceRoot,
        outerAgentDefaultProvider: "fake"
      });
      createTask(context, { id: "task-cli-daemon", projectId: project.id, title: "daemon" });
    });
    const result = runCli(["daemon", "tick", "--db", databasePath]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "acted",
      actions: expect.arrayContaining([
        expect.objectContaining({ kind: "agent_tool_skipped", status: "skipped" })
      ])
    });
  });

  it("task control 命令可通过 Core runtime 暂停 task", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-cli-task-control-")), "task-control.sqlite");
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, { id: "project-cli-task-control", name: "control" });
      createTask(context, { id: "task-cli-task-control", projectId: project.id, title: "control" });
    });

    const result = runCli([
      "task",
      "control",
      "--db",
      databasePath,
      "--task",
      "task-cli-task-control",
      "--action",
      "pause",
      "--expected-version",
      "0",
      "--actor",
      "cli-test"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      action: "pause",
      previousStatus: "created",
      nextStatus: "paused",
      task: { status: "paused" }
    });
  });

  it("pr create 命令要求 title 和 body artifact 参数", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-cli-pr-")), "pr.sqlite");
    runMigrations(databasePath);

    const result = runCli(["pr", "create", "--db", databasePath, "--task", "task-pr"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("缺少 --title 参数");
  });

  it("pr approve 命令是 operator-only，不会作为 surface tool 出现", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-cli-pr-surface-")), "pr.sqlite");
    runMigrations(databasePath);
    withDatabase(databasePath, (context) => {
      const project = createProject(context, { id: "project-cli-pr-surface", name: "pr" });
      createTask(context, { id: "task-cli-pr-surface", projectId: project.id, title: "pr surface" });
    });

    const result = runCli(["surface", "--db", databasePath, "--task", "task-cli-pr-surface"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).available_tools.map((tool: { name: string }) => tool.name)).not.toContain("approve_merge");
    expect(JSON.parse(result.stdout).available_tools.map((tool: { name: string }) => tool.name)).not.toContain("pr approve");
  });
});
