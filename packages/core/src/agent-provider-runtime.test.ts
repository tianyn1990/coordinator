import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCodexSdkBridge } from "./agent-provider-runtime.js";
import {
  ActiveResourceConflictError,
  createAttempt,
  createAgentSession,
  createProject,
  createTask,
  createWorkspace,
  createWorkflowRun,
  getOperationByIdempotencyKey,
  listTaskEvents,
  runMigrations,
  withDatabase
} from "@coordinator/db";
import {
  ClaudeCodeProvider,
  CodexProvider,
  FakeAgentProvider,
  ProviderUnavailableError,
  buildAgentActivitySummary,
  inspectAgentSession,
  normalizeProviderEvent,
  runCoordinatorAgentSession,
  runInnerCodingAgentSession,
  type AgentProviderRunInput,
  type AgentProviderRunner,
  type AgentProviderSdkRunInput
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

function createInnerWorkflowFixture(databasePath: string) {
  const repoPath = createRepoPath();
  const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-agent-inner-workspaces-"));
  return withDatabase(databasePath, (context) => {
    const project = createProject(context, {
      id: "project-inner-agent",
      name: "inner agent",
      repoPath,
      defaultBranch: "main",
      workspaceRoot,
      workflowLauncher: "workflow",
      innerAgentDefaultProvider: "fake-inner"
    });
    const task = createTask(context, {
      id: "task-inner-agent",
      projectId: project.id,
      title: "inner agent task",
      description: "run inner coding agent",
      autonomy: "balanced"
    });
    const attempt = createAttempt(context, {
      id: "attempt-inner-agent",
      projectId: project.id,
      taskId: task.id
    });
    const workspacePath = join(workspaceRoot, project.id, task.id, attempt.id);
    const workspaceRepoPath = join(workspacePath, "repo");
    mkdirSync(join(workspaceRepoPath, ".git"), { recursive: true });
    const workspace = createWorkspace(context, {
      id: "workspace-inner-agent",
      projectId: project.id,
      taskId: task.id,
      attemptId: attempt.id,
      status: "ready",
      workspacePath,
      repoPath: workspaceRepoPath,
      branch: "coordinator/task-inner-agent/attempt-inner-agent",
      baseBranch: "main"
    });
    const workflowRun = createWorkflowRun(context, {
      id: "workflow-inner-agent",
      projectId: project.id,
      taskId: task.id,
      attemptId: attempt.id,
      profileId: "feature",
      status: "running",
      externalId: "run-inner-agent"
    });
    return {
      projectId: project.id,
      taskId: task.id,
      attemptId: attempt.id,
      workspaceId: workspace.id,
      workspaceRepoPath,
      workflowRunId: workflowRun.id
    };
  });
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
    expect(readFileSync(result.artifacts.promptPath, "utf8")).toContain("coordinator-tool 代码块");
    expect(readFileSync(result.artifacts.promptPath, "utf8")).toContain("普通推进或观察工具默认不需要 coordinator-artifact");
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

  it("inner coding agent 在 workspace repo 中运行并生成 workflow-aware evidence prompt", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createInnerWorkflowFixture(databasePath);
    const seen: AgentProviderRunInput[] = [];
    const provider = {
      id: "fake-inner",
      kind: "fake",
      capabilities: ["code-editing", "workflow-runtime"],
      run(input: AgentProviderRunInput) {
        seen.push(input);
        return {
          finalResponse: "我已检查 workflow 状态，当前需要确认需求范围。",
          transcript: JSON.stringify({ type: "provider.raw_event", event: "inner.completed" })
        };
      }
    };

    const result = withDatabase(databasePath, (context) =>
      runInnerCodingAgentSession(context, {
        taskId: fixture.taskId,
        workflowRunId: fixture.workflowRunId,
        provider
      })
    );

    expect(result.session).toMatchObject({
      taskId: fixture.taskId,
      attemptId: fixture.attemptId,
      role: "inner",
      providerKind: "fake-inner",
      status: "completed"
    });
    expect(seen[0]).toMatchObject({
      cwd: fixture.workspaceRepoPath,
      metadata: {
        role: "inner",
        taskId: fixture.taskId,
        attemptId: fixture.attemptId,
        workspaceId: fixture.workspaceId,
        workflowRunId: fixture.workflowRunId
      }
    });
    expect(readFileSync(result.artifacts.promptPath, "utf8")).toContain("workflow protocol status --run run-inner-agent");
    expect(readFileSync(result.artifacts.promptPath, "utf8")).toContain("不要读取、解析或修改 `.workflow` private state");
    expect(readFileSync(result.artifacts.promptPath, "utf8")).toContain("不要自动执行需要人类确认的 workflow gate");
    expect(readFileSync(result.artifacts.promptPath, "utf8")).not.toContain("coordinator-tool 代码块");
    expect(readFileSync(result.artifacts.finalResponsePath, "utf8")).toContain("确认需求范围");

    const persisted = withDatabase(databasePath, (context) => ({
      operation: getOperationByIdempotencyKey(
        context,
        `agent:session:${fixture.taskId}:inner:fake-inner:workflow-${fixture.workflowRunId}:v0`
      ),
      events: listTaskEvents(context, fixture.taskId)
    }));
    expect(persisted.operation).toMatchObject({ status: "succeeded" });
    expect(persisted.events.find((event) => event.type === "agent.session_completed")?.payload).toMatchObject({
      role: "inner",
      providerId: "fake-inner",
      agentActivity: {
        state: "completed",
        artifactRefs: { finalResponsePath: result.artifacts.finalResponsePath }
      }
    });
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
      status: "unknown",
      agentActivity: {
        state: "unknown",
        providerId: "failing",
        failureKind: "unknown"
      }
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
      "--ask-for-approval",
      "never",
      "exec",
      "--cd",
      "/tmp",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--output-last-message",
      outputPath,
      "-"
    ]);
    expect(calls[0].input).toContain("large context");
  });

  it("CodexProvider 默认优先使用 SDK adapter 并保留权限 evidence", () => {
    const sdkCalls: AgentProviderSdkRunInput[] = [];
    const sdkRunner = (input: AgentProviderSdkRunInput) => {
      sdkCalls.push(input);
      return {
        finalResponse: "codex sdk final",
        transcript: JSON.stringify({ type: "provider.raw_event", provider: "codex", event: "turn.completed" }),
        providerSessionId: "codex-thread-1",
        providerVersion: "0.test"
      };
    };
    const cliRunner: AgentProviderRunner = () => {
      throw new Error("CLI fallback should not run");
    };
    const root = mkdtempSync(join(tmpdir(), "coordinator-agent-codex-sdk-"));
    const promptPath = join(root, "prompt.md");
    const transcriptPath = join(root, "transcript.jsonl");
    writeFileSync(promptPath, "# prompt\nsdk context", "utf8");

    const provider = new CodexProvider({ sdkRunner, cliRunner });
    const result = provider.run({
      sessionId: "session-1",
      cwd: root,
      promptPath,
      outputPath: join(root, "final.md"),
      transcriptPath,
      timeoutMs: 1234,
      metadata: { providerId: "codex", role: "outer", taskId: "task-1" }
    });

    expect(result).toMatchObject({
      finalResponse: "codex sdk final\n",
      providerSessionId: "codex-thread-1",
      implementationMode: "sdk",
      permissionProfile: "codex:read-only:approval-never",
      rawEventArtifactPath: transcriptPath
    });
    expect(sdkCalls[0]).toMatchObject({
      cwd: root,
      prompt: "# prompt\nsdk context",
      permissionProfile: "codex:read-only:approval-never",
      sdkPackageName: "@openai/codex-sdk"
    });
    expect(typeof sdkCalls[0].sdkImportPath).toBe("string");
    expect(existsSync(sdkCalls[0].sdkImportPath!)).toBe(true);
  });

  it("CodexProvider inner session 使用 workspace-write profile 且不使用 danger-full-access", () => {
    const sdkCalls: AgentProviderSdkRunInput[] = [];
    const sdkRunner = (input: AgentProviderSdkRunInput) => {
      sdkCalls.push(input);
      return { finalResponse: "codex inner sdk final" };
    };
    const root = mkdtempSync(join(tmpdir(), "coordinator-agent-codex-inner-sdk-"));
    const promptPath = join(root, "prompt.md");
    const transcriptPath = join(root, "transcript.jsonl");
    writeFileSync(promptPath, "# inner prompt", "utf8");

    const provider = new CodexProvider({
      sdkRunner,
      cliRunner: () => {
        throw new Error("CLI fallback should not run");
      }
    });
    const result = provider.run({
      sessionId: "inner-session-1",
      cwd: root,
      promptPath,
      outputPath: join(root, "final.md"),
      transcriptPath,
      timeoutMs: 1234,
      metadata: { providerId: "codex", role: "inner", taskId: "task-1", workspaceId: "workspace-1" }
    });

    expect(result.permissionProfile).toBe("codex:workspace-write:approval-never");
    expect(result.permissionProfile).not.toContain("danger-full-access");
    expect(sdkCalls[0]).toMatchObject({
      cwd: root,
      permissionProfile: "codex:workspace-write:approval-never",
      metadata: { role: "inner" }
    });
  });

  it("CodexProvider 在 SDK unavailable 时受控回落到 CLI fallback", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const sdkRunner = () => {
      throw new ProviderUnavailableError("codex sdk missing");
    };
    const cliRunner: AgentProviderRunner = (command, args) => {
      calls.push({ command, args });
      return "codex cli final";
    };
    const root = mkdtempSync(join(tmpdir(), "coordinator-agent-codex-fallback-"));
    const promptPath = join(root, "prompt.md");
    writeFileSync(promptPath, "# prompt", "utf8");

    const provider = new CodexProvider({ sdkRunner, cliRunner });
    const result = provider.run({
      sessionId: "session-1",
      cwd: root,
      promptPath,
      outputPath: join(root, "final.md"),
      transcriptPath: join(root, "transcript.jsonl"),
      timeoutMs: 1000,
      metadata: { providerId: "codex", role: "outer" }
    });

    expect(result).toMatchObject({
      finalResponse: "codex cli final\n",
      implementationMode: "cli-fallback",
      permissionProfile: "codex:read-only:approval-never"
    });
    expect(calls[0].command).toBe("codex");
  });

  it("Codex SDK bridge 把 raw events 直接写入 transcript artifact", () => {
    const root = mkdtempSync(join(tmpdir(), "coordinator-agent-codex-bridge-"));
    const fakeSdkPath = join(root, "fake-codex-sdk.mjs");
    const transcriptPath = join(root, "transcript.jsonl");
    const promptPath = join(root, "prompt.md");
    writeFileSync(promptPath, "# prompt", "utf8");
    writeFileSync(transcriptPath, "", "utf8");
    writeFileSync(
      fakeSdkPath,
      [
        "export class Codex {",
        "  startThread() {",
        "    return {",
        "      id: 'thread-final',",
        "      async runStreamed() {",
        "        return { events: (async function* () {",
        "          yield { type: 'thread.started', thread_id: 'thread-1' };",
        "          yield { type: 'item.completed', item: { type: 'agent_message', text: 'sdk bridge final' } };",
        "        })() };",
        "      }",
        "    };",
        "  }",
        "}"
      ].join("\n"),
      "utf8"
    );

    const result = runCodexSdkBridge({
      sessionId: "session-1",
      cwd: root,
      promptPath,
      outputPath: join(root, "final.md"),
      transcriptPath,
      timeoutMs: 1000,
      metadata: { providerId: "codex", role: "outer" },
      prompt: "# prompt",
      permissionProfile: "codex:read-only:approval-never",
      sdkPackageName: "fake-codex-sdk",
      sdkImportPath: fakeSdkPath,
      providerVersion: "0.test"
    });

    expect(result).toMatchObject({
      finalResponse: "sdk bridge final\n",
      providerSessionId: "thread-1",
      implementationMode: "sdk",
      permissionProfile: "codex:read-only:approval-never"
    });
    expect(result.transcript).toBeUndefined();
    expect(readFileSync(transcriptPath, "utf8")).toContain("provider.raw_event");
  });

  it("Codex SDK bridge 遇到 turn.failed 不会伪装成成功响应", () => {
    const root = mkdtempSync(join(tmpdir(), "coordinator-agent-codex-bridge-fail-"));
    const fakeSdkPath = join(root, "fake-codex-sdk.mjs");
    const transcriptPath = join(root, "transcript.jsonl");
    const promptPath = join(root, "prompt.md");
    writeFileSync(promptPath, "# prompt", "utf8");
    writeFileSync(transcriptPath, "", "utf8");
    writeFileSync(
      fakeSdkPath,
      [
        "export class Codex {",
        "  startThread() {",
        "    return {",
        "      id: 'thread-final',",
        "      async runStreamed() {",
        "        return { events: (async function* () {",
        "          yield { type: 'thread.started', thread_id: 'thread-1' };",
        "          yield { type: 'turn.failed', error: { message: 'auth failed' } };",
        "        })() };",
        "      }",
        "    };",
        "  }",
        "}"
      ].join("\n"),
      "utf8"
    );

    expect(() =>
      runCodexSdkBridge({
        sessionId: "session-1",
        cwd: root,
        promptPath,
        outputPath: join(root, "final.md"),
        transcriptPath,
        timeoutMs: 1000,
        metadata: { providerId: "codex", role: "outer" },
        prompt: "# prompt",
        permissionProfile: "codex:read-only:approval-never",
        sdkPackageName: "fake-codex-sdk",
        sdkImportPath: fakeSdkPath,
        providerVersion: "0.test"
      })
    ).toThrow(ProviderUnavailableError);
    expect(readFileSync(transcriptPath, "utf8")).toContain("turn.failed");
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

  it("ClaudeCodeProvider 默认优先使用 SDK adapter 并保留权限 evidence", () => {
    const sdkCalls: AgentProviderSdkRunInput[] = [];
    const sdkRunner = (input: AgentProviderSdkRunInput) => {
      sdkCalls.push(input);
      return {
        finalResponse: "claude sdk final",
        transcript: JSON.stringify({ type: "provider.raw_event", provider: "claude-code", event: "result" }),
        providerSessionId: "claude-session-1",
        providerVersion: "0.test"
      };
    };
    const cliRunner: AgentProviderRunner = () => {
      throw new Error("CLI fallback should not run");
    };
    const root = mkdtempSync(join(tmpdir(), "coordinator-agent-claude-sdk-"));
    const promptPath = join(root, "prompt.md");
    const transcriptPath = join(root, "transcript.jsonl");
    writeFileSync(promptPath, "# prompt\nsdk context", "utf8");

    const provider = new ClaudeCodeProvider({ sdkRunner, cliRunner });
    const result = provider.run({
      sessionId: "session-1",
      cwd: root,
      promptPath,
      outputPath: join(root, "final.md"),
      transcriptPath,
      timeoutMs: 1234,
      metadata: { providerId: "claude-code", role: "outer", taskId: "task-1" }
    });

    expect(result).toMatchObject({
      finalResponse: "claude sdk final\n",
      providerSessionId: "claude-session-1",
      implementationMode: "sdk",
      permissionProfile: "claude-code:dontAsk:tools-none",
      rawEventArtifactPath: transcriptPath
    });
    expect(sdkCalls[0]).toMatchObject({
      cwd: root,
      prompt: "# prompt\nsdk context",
      permissionProfile: "claude-code:dontAsk:tools-none",
      sdkPackageName: "@anthropic-ai/claude-agent-sdk"
    });
    expect(typeof sdkCalls[0].sdkImportPath).toBe("string");
    expect(existsSync(sdkCalls[0].sdkImportPath!)).toBe(true);
  });

  it("ClaudeCodeProvider inner session 使用可编辑 profile 且不使用 bypassPermissions", () => {
    const sdkCalls: AgentProviderSdkRunInput[] = [];
    const sdkRunner = (input: AgentProviderSdkRunInput) => {
      sdkCalls.push(input);
      return { finalResponse: "claude inner sdk final" };
    };
    const root = mkdtempSync(join(tmpdir(), "coordinator-agent-claude-inner-sdk-"));
    const promptPath = join(root, "prompt.md");
    const transcriptPath = join(root, "transcript.jsonl");
    writeFileSync(promptPath, "# inner prompt", "utf8");

    const provider = new ClaudeCodeProvider({
      sdkRunner,
      cliRunner: () => {
        throw new Error("CLI fallback should not run");
      }
    });
    const result = provider.run({
      sessionId: "inner-session-1",
      cwd: root,
      promptPath,
      outputPath: join(root, "final.md"),
      transcriptPath,
      timeoutMs: 1234,
      metadata: { providerId: "claude-code", role: "inner", taskId: "task-1", workspaceId: "workspace-1" }
    });

    expect(result.permissionProfile).toBe("claude-code:acceptEdits:claude-code-tools");
    expect(result.permissionProfile).not.toContain("bypass");
    expect(sdkCalls[0]).toMatchObject({
      cwd: root,
      permissionProfile: "claude-code:acceptEdits:claude-code-tools",
      metadata: { role: "inner" }
    });
  });

  it("SDK raw events 只写入 transcript artifact，不进入 Core event payload", () => {
    const databasePath = createMigratedDatabase();
    const fixture = createTaskFixture(databasePath);
    const rawSecret = "raw-sdk-event-secret-lockToken-provider-private-session";
    const provider = {
      id: "sdk-fake",
      kind: "fake",
      capabilities: ["test"],
      run(_input: AgentProviderRunInput) {
        return {
          finalResponse: "sdk completed",
          transcript: JSON.stringify({ type: "provider.raw_event", payload: rawSecret }),
          providerSessionId: "provider-session-1",
          providerVersion: "0.test",
          implementationMode: "sdk" as const,
          permissionProfile: "test-readonly",
          rawEventArtifactPath: _input.transcriptPath
        };
      }
    };

    const result = withDatabase(databasePath, (context) =>
      runCoordinatorAgentSession(context, { taskId: fixture.taskId, provider })
    );
    const transcript = readFileSync(result.artifacts.transcriptPath, "utf8");
    const events = withDatabase(databasePath, (context) => listTaskEvents(context, fixture.taskId));

    expect(transcript).toContain(rawSecret);
    expect(JSON.stringify(events)).not.toContain(rawSecret);
    expect(events.find((event) => event.type === "agent.session_completed")?.payload).toMatchObject({
      implementationMode: "sdk",
      providerSessionId: "provider-session-1",
      permissionProfile: "test-readonly",
      rawEventArtifactPath: result.artifacts.transcriptPath,
      agentActivity: {
        state: "completed",
        providerId: "sdk-fake",
        providerSessionId: "provider-session-1",
        implementationMode: "sdk",
        permissionProfile: "test-readonly",
        artifactRefs: {
          rawEventArtifactPath: result.artifacts.transcriptPath,
          finalResponsePath: result.artifacts.finalResponsePath
        }
      }
    });
  });

  it("provider raw event 只归一化为白名单摘要", () => {
    const normalized = normalizeProviderEvent({
      type: "provider.raw_event",
      providerId: "codex",
      createdAt: "2026-05-25T00:00:00.000Z",
      event: {
        type: "item.completed",
        item: {
          type: "agent_message",
          text: "raw message body should not leak"
        }
      }
    });

    expect(normalized).toMatchObject({
      kind: "message_delta",
      providerId: "codex",
      timestamp: "2026-05-25T00:00:00.000Z",
      metadata: { providerEventType: "item.completed" }
    });
    expect(JSON.stringify(normalized)).not.toContain("raw message body should not leak");
  });

  it("独立 raw event artifact 可作为 normalized activity 来源", () => {
    const root = mkdtempSync(join(tmpdir(), "coordinator-agent-activity-"));
    const rawEventPath = join(root, "provider-events.jsonl");
    const transcriptPath = join(root, "transcript.jsonl");
    writeFileSync(
      rawEventPath,
      `${JSON.stringify({
        type: "provider.raw_event",
        providerId: "codex",
        createdAt: "2026-05-25T00:00:00.000Z",
        event: { type: "turn.completed" }
      })}\n`,
      "utf8"
    );
    writeFileSync(transcriptPath, "", "utf8");

    const activity = buildAgentActivitySummary({
      state: "completed",
      providerId: "codex",
      rawEventArtifactPath: rawEventPath,
      transcriptPath,
      fallbackTimestamp: "2026-05-24T00:00:00.000Z"
    });

    expect(activity).toMatchObject({
      lastActivityAt: "2026-05-25T00:00:00.000Z",
      latestEvent: { kind: "turn_completed" },
      artifactRefs: { rawEventArtifactPath: rawEventPath, transcriptPath }
    });
  });

  it("planning-only session 不要求 provider cwd 指向 repo", () => {
    const databasePath = createMigratedDatabase();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "coordinator-agent-no-repo-workspaces-"));
    withDatabase(databasePath, (context) => {
      const project = createProject(context, {
        id: "project-no-repo",
        name: "no repo",
        outerAgentDefaultProvider: "fake",
        workspaceRoot
      });
      createTask(context, { id: "task-no-repo", projectId: project.id, title: "no repo" });
    });

    const result = withDatabase(databasePath, (context) =>
      runCoordinatorAgentSession(context, { taskId: "task-no-repo", provider: new FakeAgentProvider() })
    );

    expect(result.session.status).toBe("completed");
    expect(result.artifacts.promptPath).toContain("project-no-repo");
  });
});
