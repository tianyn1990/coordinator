import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProject, runMigrations, withDatabase } from "@coordinator/db";
import { ProjectRegistryInputError, detectGitProvider, registerProject, viewProjectRegistry } from "./index.js";

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
});
