import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ActiveResourceConflictError,
  createAttempt,
  createAgentSession,
  createProject,
  createTask,
  createWorkspace,
  getOperationByIdempotencyKey,
  listTaskEvents,
  runMigrations,
  withDatabase
} from "@coordinator/db";
import {
  ClaudeCodeProvider,
  CodexProvider,
  FakeAgentProvider,
  inspectAgentSession,
  runCoordinatorAgentSession,
  type AgentProviderRunInput,
  type AgentProviderRunner
} from "./index.js";

function createMigratedDatabase(): string {
  const databasePath = join(mkdtempSync(join(tmpdir(), "coordinator-agent-db-")), "agent.sqlite");
  runMigrations(databasePath);
  return databasePath;
}

function createRepoPath(): string {
  const repoPath = mkdtempSync(join(tmpdir(), "coordinator-agent-repo-"));
  mkdirSync(join(repoPath, ".git"));
  return repoPath;
}

function createTaskFixture(databasePath: string) {
  const repoPath = createRepoPath();
  const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-agent-workspaces-"));
  const ids = withDatabase(databasePath, (context) => {
    const project = createProject(context, {
      id: "project-agent",
      name: "agent",
      repoPath,
      defaultBranch: "main",
      workspaceRoot,
      outerAgentDefaultProvider: "fake"
    });
    const task = createTask(context, {
      id: "task-agent",
      projectId: project.id,
      title: "agent task",
      description: "run outer coordinator agent",
      autonomy: "balanced"
    });
    return { projectId: project.id, taskId: task.id };
  });
  return { ...ids, repoPath, workspaceRoot };
}

describe("agent provider runtime", () => {
  it("fake provider 基于 Coordinator Surface 运行并保存 session artifacts", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);

    const result = withDatabase(databasePath, (context) =>
      runCoordinatorAgentSession(context, {
        taskId: fixture.taskId,
        provider: new FakeAgentProvider("done")
      })
    );

    expect(result.session).toMatchObject({
      taskId: fixture.taskId,
      role: "outer",
      providerKind: "fake",
      status: "completed"
    });
    expect(result.finalResponse).toContain("done");
    expect(existsSync(result.artifacts.promptPath)).toBe(true);
    expect(existsSync(result.artifacts.surfaceJsonPath)).toBe(true);
    expect(existsSync(result.artifacts.surfaceMarkdownPath)).toBe(true);
    expect(existsSync(result.artifacts.transcriptPath)).toBe(true);
    expect(existsSync(result.artifacts.finalResponsePath)).toBe(true);
    expect(readFileSync(result.artifacts.promptPath, "utf8")).toContain("# Coordinator Surface");
    expect(readFileSync(result.artifacts.promptPath, "utf8")).toContain("本轮 runtime 还没有开放真实 agent tools executor");
    expect(readFileSync(result.artifacts.promptPath, "utf8")).toContain("description: run outer coordinator agent");
    expect(readFileSync(result.artifacts.promptPath, "utf8")).toContain("workspace: 当前 surface 未发现 active workspace");

    const persisted = withDatabase(databasePath, (context) => ({
      operation: getOperationByIdempotencyKey(context, `agent:session:${fixture.taskId}:outer:fake:task-v0`),
      events: listTaskEvents(context, fixture.taskId)
    }));
    expect(persisted.operation).toMatchObject({ kind: "agent:session", status: "succeeded" });
    expect(persisted.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["agent.session_created", "agent.session_started", "agent.session_completed"])
    );
  });

  it("显式 requestId 会进入稳定 operation idempotency key", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);

    const result = withDatabase(databasePath, (context) =>
      runCoordinatorAgentSession(context, {
        taskId: fixture.taskId,
        requestId: "operator-request-1",
        provider: new FakeAgentProvider("request")
      })
    );

    const operation = withDatabase(databasePath, (context) =>
      getOperationByIdempotencyKey(context, `agent:session:${fixture.taskId}:outer:fake:operator-request-1`)
    );
    expect(result.session.status).toBe("completed");
    expect(operation).toMatchObject({ status: "succeeded" });
  });

  it("即使存在 active workspace，outer provider cwd 仍为 sessionRoot", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const seen: AgentProviderRunInput[] = [];
    const provider = {
      id: "fake-cwd",
      kind: "fake",
      capabilities: ["test"],
      run(input: AgentProviderRunInput) {
        seen.push(input);
        return { finalResponse: "cwd ok" };
      }
    };
    const workspacePath = mkdtempSync(join(tmpdir(), "coordinator-agent-workspace-"));
    const workspaceRepoPath = join(workspacePath, "repo");
    mkdirSync(workspaceRepoPath, { recursive: true });
    withDatabase(databasePath, (context) => {
      const attempt = createAttempt(context, {
        id: "attempt-agent-cwd",
        projectId: fixture.projectId,
        taskId: fixture.taskId
      });
      createWorkspace(context, {
        id: "workspace-agent-cwd",
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        attemptId: attempt.id,
        status: "ready",
        workspacePath,
        repoPath: workspaceRepoPath,
        branch: "coordinator/task-agent/attempt-agent-cwd",
        baseBranch: "main"
      });
    });

    const result = withDatabase(databasePath, (context) =>
      runCoordinatorAgentSession(context, { taskId: fixture.taskId, provider })
    );

    expect(seen[0].cwd).toContain(join(workspacePath, "coordinator", "sessions"));
    expect(seen[0].cwd).not.toBe(workspaceRepoPath);
    expect(readFileSync(result.artifacts.promptPath, "utf8")).toContain("workspace: workspace-agent-cwd (ready)");
    expect(readFileSync(result.artifacts.promptPath, "utf8")).toContain(`workspace_path: ${workspacePath}`);
  });

  it("拒绝同一 task 的重复 active outer agent session", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);

    expect(() =>
      withDatabase(databasePath, (context) => {
        createAgentSession(context, {
          id: "active-agent",
          projectId: fixture.projectId,
          taskId: fixture.taskId,
          providerKind: "fake",
          role: "outer",
          status: "running"
        });
        runCoordinatorAgentSession(context, { taskId: fixture.taskId, provider: new FakeAgentProvider() });
      })
    ).toThrow(ActiveResourceConflictError);
  });

  it("provider 失败后保留受控 unknown 状态和 failure event", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);

    const provider = {
      id: "failing",
      kind: "fake",
      capabilities: ["test"],
      run(_input: AgentProviderRunInput) {
        throw new Error("provider crashed");
      }
    };

    expect(() =>
      withDatabase(databasePath, (context) =>
        runCoordinatorAgentSession(context, {
          taskId: fixture.taskId,
          provider
        })
      )
    ).toThrow(/provider crashed/);

    const events = withDatabase(databasePath, (context) => listTaskEvents(context, fixture.taskId));
    expect(events.map((event) => event.type)).toContain("agent.session_failed");
    expect(events.find((event) => event.type === "agent.session_failed")?.payload).toMatchObject({
      providerId: "failing",
      status: "unknown"
    });
  });

  it("inspectAgentSession 返回机器事实和 artifact refs", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const result = withDatabase(databasePath, (context) =>
      runCoordinatorAgentSession(context, {
        taskId: fixture.taskId,
        provider: new FakeAgentProvider()
      })
    );

    const inspected = withDatabase(databasePath, (context) =>
      inspectAgentSession(context, { agentSessionId: result.session.id })
    );

    expect(inspected.session.id).toBe(result.session.id);
    expect(inspected.artifacts.finalResponsePath).toBe(result.artifacts.finalResponsePath);
  });

  it("CodexProvider runner 参数保持窄，prompt 通过 stdin 传入", () => {
    const calls: Array<{ command: string; args: string[]; input: string; timeoutMs: number }> = [];
    const runner: AgentProviderRunner = (command, args, options) => {
      calls.push({ command, args, input: options.input, timeoutMs: options.timeoutMs });
      return "codex final";
    };
    const root = mkdtempSync(join(tmpdir(), "coordinator-agent-codex-"));
    const promptPath = join(root, "prompt.md");
    const outputPath = join(root, "final.md");
    const transcriptPath = join(root, "transcript.jsonl");
    writeFileSync(promptPath, "# prompt\nlarge context", "utf8");

    const provider = new CodexProvider(runner);
    const result = provider.run({
      sessionId: "session-1",
      cwd: "/tmp",
      promptPath,
      outputPath,
      transcriptPath,
      timeoutMs: 1234,
      metadata: { providerId: "codex", role: "outer", taskId: "task-1" }
    });

    expect(result.finalResponse).toBe("codex final\n");
    expect(calls[0]).toMatchObject({
      command: "codex",
      timeoutMs: 1234
    });
    expect(calls[0].args).toEqual([
      "exec",
      "--cd",
      "/tmp",
      "--sandbox",
      "read-only",
      "--ask-for-approval",
      "never",
      "--skip-git-repo-check",
      "--output-last-message",
      outputPath,
      "-"
    ]);
    expect(calls[0].input).toContain("large context");
  });

  it("ClaudeCodeProvider 使用非交互 print 模式", () => {
    const calls: Array<{ command: string; args: string[]; input: string }> = [];
    const runner: AgentProviderRunner = (command, args, options) => {
      calls.push({ command, args, input: options.input });
      return "claude final";
    };
    const root = mkdtempSync(join(tmpdir(), "coordinator-agent-claude-"));
    const promptPath = join(root, "prompt.md");
    writeFileSync(promptPath, "# prompt", "utf8");

    const provider = new ClaudeCodeProvider(runner);
    const result = provider.run({
      sessionId: "session-1",
      cwd: root,
      promptPath,
      outputPath: join(root, "final.md"),
      transcriptPath: join(root, "transcript.jsonl"),
      timeoutMs: 1000,
      metadata: { providerId: "claude-code", role: "outer" }
    });

    expect(result.finalResponse).toBe("claude final\n");
    expect(calls[0].command).toBe("claude");
    expect(calls[0].args).toEqual(["--bare", "--print", "--permission-mode", "dontAsk", "--tools", "", "--output-format", "text"]);
    expect(calls[0].input).toContain("# prompt");
  });

  it("planning-only session 不要求 provider cwd 指向 repo", () => {
    const databasePath = createMigratedDatabase();
    withDatabase(databasePath, (context) => {
      const project = createProject(context, { id: "project-no-repo", name: "no repo", outerAgentDefaultProvider: "fake" });
      createTask(context, { id: "task-no-repo", projectId: project.id, title: "no repo" });
    });

    const result = withDatabase(databasePath, (context) =>
      runCoordinatorAgentSession(context, { taskId: "task-no-repo", provider: new FakeAgentProvider() })
    );

    expect(result.session.status).toBe("completed");
    expect(result.artifacts.promptPath).toContain("project-no-repo");
  });
});
