import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProject, createTask, runMigrations, withDatabase } from "@coordinator/db";
import {
  ProjectRegistryInputError,
  buildTaskSurfaceFromDb,
  detectGitProvider,
  registerProject,
  viewProjectRegistry
} from "./index.js";

function createGitRepoFixture(providerUrl = "git@github.com:hetao/coordinator.git"): string {
  const repoPath = mkdtempSync(join(tmpdir(), "coordinator-registry-"));
  mkdirSync(join(repoPath, ".git"));
  writeFileSync(join(repoPath, ".git", "config"), `[remote "origin"]\n\turl = ${providerUrl}\n`);
  writeFileSync(join(repoPath, ".git", "HEAD"), "ref: refs/heads/main\n");
  return repoPath;
}

function fakeGitRunner(args: string[], options: { cwd: string }): string {
  if (args[0] === "rev-parse") {
    return "true\n";
  }
  if (args[0] === "config") {
    return "git@github.com:hetao/coordinator.git\n";
  }
  if (args[0] === "symbolic-ref") {
    return "refs/remotes/origin/main\n";
  }
  return "";
}

describe("project registry", () => {
  it("detectGitProvider 能识别 GitHub 和 GitLab", () => {
    expect(detectGitProvider("git@github.com:hetao/coordinator.git")).toMatchObject({ kind: "github" });
    expect(detectGitProvider("git@gitlab.com:hetao/coordinator.git")).toMatchObject({ kind: "gitlab" });
  });

  it("注册工程时缺少默认分支会阻塞", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-registry-db-")), "registry.sqlite");
    runMigrations(databasePath);

    const result = withDatabase(databasePath, (context) =>
      registerProject(context, {
        repoPath: createGitRepoFixture(),
        gitRunner: fakeGitRunner
      })
    );

    expect(result.blocked).toBe(true);
    expect(result.blockers).toContain("default-branch-confirmation-required");
  });

  it("注册工程可保存 registry 真相", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-registry-db-")), "registry.sqlite");
    runMigrations(databasePath);

    const result = withDatabase(databasePath, (context) =>
      registerProject(context, {
        repoPath: createGitRepoFixture(),
        confirmedDefaultBranch: "main",
        workflowLauncher: "workflow",
        outerAgentDefaultProvider: "codex",
        innerAgentDefaultProvider: "claude-code",
        gitRunner: fakeGitRunner
      })
    );

    expect(result.blocked).toBe(false);
    expect(result.project).toMatchObject({
      defaultBranch: "main",
      workflowLauncher: "workflow",
      outerAgentDefaultProvider: "codex",
      innerAgentDefaultProvider: "claude-code"
    });

    const projects = withDatabase(databasePath, (context) => viewProjectRegistry(context));
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      defaultBranch: "main",
      registrationStatus: "registered"
    });
  });

  it("缺少 launcher/provider defaults 时以 degraded mode 明确记录缺失能力", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-registry-db-")), "registry.sqlite");
    runMigrations(databasePath);

    const result = withDatabase(databasePath, (context) =>
      registerProject(context, {
        repoPath: createGitRepoFixture(),
        confirmedDefaultBranch: "main",
        gitRunner: fakeGitRunner
      })
    );

    expect(result.project).toMatchObject({
      registrationStatus: "degraded",
      registryNotes: {
        missingCapabilities: ["workflow-launcher", "outer-agent-default-provider", "inner-agent-default-provider"]
      }
    });
  });

  it("拒绝非法 provider override 和空默认分支", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-registry-db-")), "registry.sqlite");
    runMigrations(databasePath);

    expect(() =>
      withDatabase(databasePath, (context) =>
        registerProject(context, {
          repoPath: createGitRepoFixture(),
          providerOverride: "bitbucket",
          confirmedDefaultBranch: "main",
          gitRunner: fakeGitRunner
        })
      )
    ).toThrow(ProjectRegistryInputError);

    expect(() =>
      withDatabase(databasePath, (context) =>
        registerProject(context, {
          repoPath: createGitRepoFixture(),
          confirmedDefaultBranch: "   ",
          gitRunner: fakeGitRunner
        })
      )
    ).toThrow(ProjectRegistryInputError);
  });

  it("自动识别 GitLab host", () => {
    expect(detectGitProvider("git@gitlab.com:hetao/coordinator.git")).toMatchObject({
      kind: "gitlab",
      host: "gitlab.com"
    });
    expect(detectGitProvider("git@my.gitlab.example.com:hetao/coordinator.git", ["my.gitlab.example.com"])).toMatchObject({
      kind: "gitlab",
      host: "my.gitlab.example.com"
    });
  });

  it("task surface 以 JSON + Markdown 同源输出 bootstrap surface", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-surface-db-")), "surface.sqlite");
    runMigrations(databasePath);

    const surface = withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-surface",
        name: "coordinator",
        defaultBranch: "main",
        workflowLauncher: "workflow"
      });
      const task = createTask(context, {
        id: "task-surface",
        projectId: project.id,
        title: "surface",
        description: "build surface",
        autonomy: "balanced"
      });
      return buildTaskSurfaceFromDb(context, task.id);
    });

    expect(surface.surfaceKind).toBe("bootstrap");
    expect(surface.json.surface_id).toBe(surface.surfaceId);
    expect(surface.markdown).toContain("# Coordinator Surface");
    expect(surface.json.available_tools.map((tool) => tool.name)).toEqual(["write_execution_plan", "ask_human"]);
    expect(surface.json.denied_actions).toContain("不要绕过 workflow protocol。");
    expect(surface.json.artifact_root).toContain("/project-surface/task-surface/_task/coordinator/artifacts/");
  });

  it("task status 为 waiting_human 且无 workflow run 时 surface 不暴露工具", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-surface-db-")), "surface.sqlite");
    runMigrations(databasePath);

    const surface = withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-human",
        name: "coordinator",
        defaultBranch: "main"
      });
      const task = createTask(context, {
        id: "task-human",
        projectId: project.id,
        title: "human",
        description: "human wait",
        autonomy: "conservative"
      });
      context.db
        .prepare("UPDATE tasks SET status = ? WHERE id = ?")
        .run("waiting_human", task.id);
      context.db
        .prepare(
          `INSERT INTO human_requests (id, project_id, task_id, blocked_key, kind, status, question_artifact_path)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("human-request-1", project.id, task.id, "gate:clarify", "requirements-clarification", "pending", "human-question.md");
      return buildTaskSurfaceFromDb(context, task.id);
    });

    expect(surface.json.available_tools.map((tool) => tool.name)).toEqual([]);
  });
});
