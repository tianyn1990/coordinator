import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  ActiveResourceConflictError,
  acquireLock,
  appendEvent,
  createAgentSession,
  createArtifact,
  createOperation,
  getActiveAgentSessionByTask,
  getActiveWorkspaceByAttempt,
  getAgentSession,
  getProject,
  getTask,
  releaseLock,
  updateAgentSession,
  updateOperation,
  withTransaction,
  type AgentSessionRecord,
  type DbContext,
  type LockRecord,
  type ProjectRecord,
  type TaskRecord
} from "@coordinator/db";
import { buildTaskSurfaceFromDb, type SurfaceEnvelope } from "./surface.js";

const DEFAULT_AGENT_TIMEOUT_MS = 10 * 60 * 1000;

export type AgentProviderRunInput = {
  sessionId: string;
  cwd: string;
  promptPath: string;
  outputPath: string;
  transcriptPath: string;
  timeoutMs: number;
  metadata: {
    providerId: string;
    role: "outer" | "inner";
    taskId?: string;
    attemptId?: string;
    surfaceId?: string;
  };
};

export type AgentProviderRunResult = {
  finalResponse: string;
  transcript?: string;
  exitCode?: number;
};

export type AgentProviderRunner = (
  command: string,
  args: string[],
  options: { cwd: string; input: string; timeoutMs: number }
) => string;

export type AgentProvider = {
  id: string;
  kind: string;
  capabilities: string[];
  run(input: AgentProviderRunInput): AgentProviderRunResult;
};

export type RunCoordinatorAgentSessionInput = {
  taskId: string;
  providerId?: string;
  requestId?: string;
  provider?: AgentProvider;
  owner?: string;
  ttlMs?: number;
  timeoutMs?: number;
  now?: Date;
};

export type AgentSessionRuntimeResult = {
  session: AgentSessionRecord;
  operationId: string;
  surfaceId: string;
  artifacts: {
    promptPath: string;
    surfaceJsonPath: string;
    surfaceMarkdownPath: string;
    transcriptPath: string;
    finalResponsePath: string;
  };
  finalResponse: string;
};

export type InspectAgentSessionInput = {
  agentSessionId: string;
};

export type AgentSessionInspection = {
  session: AgentSessionRecord;
  artifacts: {
    promptPath?: string;
    surfaceJsonPath?: string;
    surfaceMarkdownPath?: string;
    transcriptPath?: string;
    finalResponsePath?: string;
  };
};

export class AgentProviderRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentProviderRuntimeError";
  }
}

export class ProviderUnavailableError extends AgentProviderRuntimeError {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export class FakeAgentProvider implements AgentProvider {
  id = "fake";
  kind = "fake";
  capabilities = ["strong-planning", "review", "test-double"];

  constructor(private readonly response = "fake coordinator agent response") {}

  run(input: AgentProviderRunInput): AgentProviderRunResult {
    const prompt = readFileSync(input.promptPath, "utf8");
    return {
      finalResponse: `${this.response}\n\nsurface=${input.metadata.surfaceId ?? "unknown"}\n`,
      transcript: JSON.stringify({
        type: "fake.final",
        sessionId: input.sessionId,
        promptPreview: prompt.slice(0, 160)
      })
    };
  }
}

export class CodexProvider implements AgentProvider {
  id = "codex";
  kind = "codex";
  capabilities = ["strong-planning", "long-context", "code-editing", "review"];

  constructor(private readonly runner: AgentProviderRunner = runCommand) {}

  run(input: AgentProviderRunInput): AgentProviderRunResult {
    const prompt = readFileSync(input.promptPath, "utf8");
    const args = [
      "exec",
      "--cd",
      input.cwd,
      "--sandbox",
      "read-only",
      "--ask-for-approval",
      "never",
      "--skip-git-repo-check",
      "--output-last-message",
      input.outputPath,
      "-"
    ];
    const stdout = this.runner("codex", args, { cwd: input.cwd, input: prompt, timeoutMs: input.timeoutMs });
    const finalResponse = existsSync(input.outputPath) ? readFileSync(input.outputPath, "utf8") : stdout;
    return {
      finalResponse: normalizeFinalResponse(finalResponse),
      transcript: JSON.stringify({ type: "provider.stdout", provider: this.id, stdoutPreview: stdout.slice(0, 2000) })
    };
  }
}

export class ClaudeCodeProvider implements AgentProvider {
  id = "claude-code";
  kind = "claude-code";
  capabilities = ["long-context", "code-editing", "review"];

  constructor(private readonly runner: AgentProviderRunner = runCommand) {}

  run(input: AgentProviderRunInput): AgentProviderRunResult {
    const prompt = readFileSync(input.promptPath, "utf8");
    const args = ["--bare", "--print", "--permission-mode", "dontAsk", "--tools", "", "--output-format", "text"];
    const stdout = this.runner("claude", args, { cwd: input.cwd, input: prompt, timeoutMs: input.timeoutMs });
    return {
      finalResponse: normalizeFinalResponse(stdout),
      transcript: JSON.stringify({ type: "provider.stdout", provider: this.id, stdoutPreview: stdout.slice(0, 2000) })
    };
  }
}

export function createAgentProvider(providerId: string, runner?: AgentProviderRunner): AgentProvider {
  if (providerId === "fake") {
    return new FakeAgentProvider();
  }
  if (providerId === "codex") {
    return new CodexProvider(runner);
  }
  if (providerId === "claude-code") {
    return new ClaudeCodeProvider(runner);
  }
  throw new ProviderUnavailableError(`不支持的 agent provider：${providerId}`);
}

export function runCoordinatorAgentSession(
  context: DbContext,
  input: RunCoordinatorAgentSessionInput
): AgentSessionRuntimeResult {
  const task = requireTaskRecord(context, input.taskId);
  const project = requireProjectRecord(context, task.projectId);
  const provider = input.provider ?? createAgentProvider(input.providerId ?? project.outerAgentDefaultProvider ?? "codex");
  const now = input.now ?? new Date();
  const timeoutMs = input.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
  const ttlMs = Math.max(input.ttlMs ?? 0, timeoutMs + 60_000);
  const owner = input.owner ?? "agent-runtime";
  const activeSession = getActiveAgentSessionByTask(context, task.id, "outer");
  if (activeSession) {
    throw new ActiveResourceConflictError(`task ${task.id} 已有 active outer agent session: ${activeSession.id}`);
  }

  const surface = buildTaskSurfaceFromDb(context, task.id);
  const sessionId = randomUUID();
  const sessionRoot = resolveSessionRoot(context, project, task, sessionId);
  const artifacts = buildSessionArtifactPaths(sessionRoot);
  const requestId = normalizeRequestId(input.requestId) ?? `task-v${task.stateVersion}`;
  const operationKey = `agent:session:${task.id}:outer:${provider.id}:${requestId}`;
  let taskLock: LockRecord | undefined;
  let session: AgentSessionRecord | undefined;
  let operationId: string | undefined;
  let sideEffectWindowStarted = false;
  try {
    const operation = createOperation(context, {
      idempotencyKey: operationKey,
      kind: "agent:session",
      projectId: project.id,
      taskId: task.id
    });
    operationId = operation.id;
    assertAgentOperationCanRun(operation.status);
    taskLock = acquireLock(context, {
      resourceKind: "task-agent",
      resourceId: task.id,
      owner,
      ttlMs,
      now
    });

    mkdirSync(sessionRoot, { recursive: true });
    writeSurfaceArtifacts(surface, artifacts);
    writePromptArtifact(surface, provider, artifacts.promptPath);
    writeFileSync(artifacts.transcriptPath, "", "utf8");

    session = withTransaction(context, () => {
      updateOperation(context, {
        operationId: operation.id,
        status: "running",
        now,
        lastObservedState: { phase: "session-artifacts-written", providerId: provider.id, surfaceId: surface.surfaceId }
      });
      const created = createAgentSession(context, {
        id: sessionId,
        projectId: project.id,
        taskId: task.id,
        providerKind: provider.id,
        role: "outer",
        status: "starting",
        transcriptPath: artifacts.transcriptPath,
        promptPath: artifacts.promptPath,
        surfaceJsonPath: artifacts.surfaceJsonPath,
        surfaceMarkdownPath: artifacts.surfaceMarkdownPath
      });
      appendEvent(context, {
        type: "agent.session_started",
        summary: `agent session started: ${created.id}`,
        projectId: project.id,
        taskId: task.id,
        agentSessionId: created.id,
        operationId: operation.id,
        lockToken: taskLock!.lockToken,
        artifactRefs: [artifacts.promptPath, artifacts.surfaceJsonPath, artifacts.surfaceMarkdownPath, artifacts.transcriptPath],
        payload: {
          providerId: provider.id,
          providerKind: provider.kind,
          capabilities: provider.capabilities,
          surfaceId: surface.surfaceId,
          cwd: sessionRoot
        }
      });
      return updateAgentSession(context, {
        agentSessionId: created.id,
        expectedStateVersion: created.stateVersion,
        status: "running",
        lock: {
          resourceKind: "task-agent",
          resourceId: task.id,
          lockToken: taskLock!.lockToken,
          now
        }
      });
    });

    sideEffectWindowStarted = true;
    const providerResult = provider.run({
      sessionId,
      cwd: sessionRoot,
      promptPath: artifacts.promptPath,
      outputPath: artifacts.finalResponsePath,
      transcriptPath: artifacts.transcriptPath,
      timeoutMs,
      metadata: {
        providerId: provider.id,
        role: "outer",
        taskId: task.id,
        surfaceId: surface.surfaceId
      }
    });
    const finalResponse = normalizeFinalResponse(providerResult.finalResponse);
    writeFileSync(artifacts.finalResponsePath, finalResponse, "utf8");
    appendTranscript(artifacts.transcriptPath, provider, sessionId, providerResult);
    const completionNow = new Date();

    const completedSession = withTransaction(context, () => {
      const updated = updateAgentSession(context, {
        agentSessionId: session!.id,
        expectedStateVersion: session!.stateVersion,
        status: "completed",
        finalResponsePath: artifacts.finalResponsePath,
        transcriptPath: artifacts.transcriptPath,
        lock: {
          resourceKind: "task-agent",
          resourceId: task.id,
          lockToken: taskLock!.lockToken,
          now: completionNow
        }
      });
      registerSessionArtifacts(context, project.id, task.id, undefined, artifacts);
      appendEvent(context, {
        type: "agent.session_completed",
        summary: `agent session completed: ${updated.id}`,
        projectId: project.id,
        taskId: task.id,
        agentSessionId: updated.id,
        operationId: operation.id,
        lockToken: taskLock!.lockToken,
        artifactRefs: Object.values(artifacts),
        payload: {
          providerId: provider.id,
          surfaceId: surface.surfaceId,
          finalResponsePreview: finalResponse.slice(0, 500)
        }
      });
      updateOperation(context, {
        operationId: operation.id,
        status: "succeeded",
        now: completionNow,
        lastObservedState: { phase: "agent-session-completed", agentSessionId: updated.id, providerId: provider.id }
      });
      return updated;
    });

    return {
      session: completedSession,
      operationId: operation.id,
      surfaceId: surface.surfaceId,
      artifacts,
      finalResponse
    };
  } catch (error) {
    const failureNow = new Date();
    if (operationId) {
      updateOperation(context, {
        operationId,
        status: sideEffectWindowStarted ? "unknown" : "failed",
        now: failureNow,
        failureCode: error instanceof Error ? error.name : "unknown",
        lastObservedState: { phase: "agent-session-failed", error: error instanceof Error ? error.message : String(error) }
      });
    }
    if (session) {
      const latest = getAgentSession(context, session.id) ?? session;
      const failedStatus = sideEffectWindowStarted ? "unknown" : "failed";
      try {
        if (!existsSync(artifacts.finalResponsePath)) {
          writeFileSync(
            artifacts.finalResponsePath,
            `agent provider failed before final response\n\n${error instanceof Error ? error.message : String(error)}\n`,
            "utf8"
          );
        }
        const updated = updateAgentSession(context, {
          agentSessionId: latest.id,
          expectedStateVersion: latest.stateVersion,
          status: failedStatus,
          finalResponsePath: artifacts.finalResponsePath,
          lock: taskLock
            ? {
                resourceKind: "task-agent",
                resourceId: task.id,
                lockToken: taskLock.lockToken,
                now: failureNow
              }
            : undefined
        });
        registerSessionArtifacts(context, project.id, task.id, undefined, artifacts);
        appendEvent(context, {
          type: "agent.session_failed",
          summary: `agent session failed: ${updated.id}`,
          projectId: project.id,
          taskId: task.id,
          agentSessionId: updated.id,
          operationId,
          lockToken: taskLock?.lockToken,
          severity: "warn",
          artifactRefs: [artifacts.promptPath, artifacts.surfaceJsonPath, artifacts.surfaceMarkdownPath, artifacts.transcriptPath],
          payload: {
            providerId: provider.id,
            status: failedStatus,
            error: error instanceof Error ? error.message : String(error)
          }
        });
      } catch {
        // 失败路径不能掩盖原始 provider 错误；后续 daemon/reconcile 会处理不一致状态。
      }
    }
    throw error;
  } finally {
    if (taskLock) {
      releaseLock(context, "task-agent", task.id, taskLock.lockToken);
    }
  }
}

export function inspectAgentSession(context: DbContext, input: InspectAgentSessionInput): AgentSessionInspection {
  const session = getAgentSession(context, input.agentSessionId);
  if (!session) {
    throw new AgentProviderRuntimeError(`agent session not found: ${input.agentSessionId}`);
  }
  appendEvent(context, {
    type: "agent.session_inspected",
    summary: `agent session inspected: ${session.id}`,
    projectId: session.projectId,
    taskId: session.taskId,
    attemptId: session.attemptId,
    agentSessionId: session.id,
    payload: { status: session.status, providerKind: session.providerKind, role: session.role }
  });
  return {
    session,
    artifacts: {
      promptPath: session.promptPath,
      surfaceJsonPath: session.surfaceJsonPath,
      surfaceMarkdownPath: session.surfaceMarkdownPath,
      transcriptPath: session.transcriptPath,
      finalResponsePath: session.finalResponsePath
    }
  };
}

function resolveSessionRoot(context: DbContext, project: ProjectRecord, task: TaskRecord, sessionId: string): string {
  const latestAttempt = context.db
    .prepare(
      `SELECT id FROM attempts
       WHERE task_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    )
    .get(task.id) as { id: string } | undefined;
  if (latestAttempt) {
    const workspace = getActiveWorkspaceByAttempt(context, latestAttempt.id);
    if (workspace?.workspacePath) {
      return join(workspace.workspacePath, "coordinator", "sessions", sessionId);
    }
  }
  const root = resolve(project.workspaceRoot ?? join(homedir(), ".coordinator", "workspaces"));
  return join(root, sanitizePathPart(project.id), "sessions", sessionId);
}

function buildSessionArtifactPaths(sessionRoot: string): AgentSessionRuntimeResult["artifacts"] {
  return {
    promptPath: join(sessionRoot, "prompt.md"),
    surfaceJsonPath: join(sessionRoot, "surface.json"),
    surfaceMarkdownPath: join(sessionRoot, "surface.md"),
    transcriptPath: join(sessionRoot, "transcript.jsonl"),
    finalResponsePath: join(sessionRoot, "final-response.md")
  };
}

function writeSurfaceArtifacts(surface: SurfaceEnvelope, artifacts: AgentSessionRuntimeResult["artifacts"]): void {
  mkdirSync(dirname(artifacts.surfaceJsonPath), { recursive: true });
  writeFileSync(artifacts.surfaceJsonPath, `${JSON.stringify(surface.json, null, 2)}\n`, "utf8");
  writeFileSync(artifacts.surfaceMarkdownPath, surface.markdown, "utf8");
}

function writePromptArtifact(surface: SurfaceEnvelope, provider: AgentProvider, promptPath: string): void {
  const prompt = [
    "# Coordinator Agent Prompt",
    "",
    "你是外层 Coordinator Agent。你只能基于下面的 Coordinator Surface 行动。",
    "如果你要请求执行工具，只能在最终回复中写一个 coordinator-tool 代码块；daemon 最多解析一个工具请求，并且仍会按当前 surface 校验可见性。",
    "格式示例：```coordinator-tool\\ntool: write_execution_plan\\nartifact: execution-plan.md\\n```",
    "如果工具需要 artifact，你可以同时写 coordinator-artifact 代码块，由 daemon 先受控写入当前 surface 的 artifact_root。",
    "artifact 格式示例：```coordinator-artifact\\npath: execution-plan.md\\ncontent:\\n# Plan\\n...\\n```",
    "不要声称已经执行工具；你只能请求工具，真正副作用由 Core tool executor 完成。",
    "复杂计划和报告必须先写入 artifact，工具参数保持窄的一层 key/value。",
    "",
    `provider_id: ${provider.id}`,
    `provider_capabilities: ${provider.capabilities.join(", ")}`,
    "",
    surface.markdown
  ].join("\n");
  writeFileSync(promptPath, prompt, "utf8");
}

function appendTranscript(
  transcriptPath: string,
  provider: AgentProvider,
  sessionId: string,
  result: AgentProviderRunResult
): void {
  const event = {
    type: "agent.final_response",
    providerId: provider.id,
    sessionId,
    exitCode: result.exitCode ?? 0,
    transcript: result.transcript,
    createdAt: new Date().toISOString()
  };
  writeFileSync(transcriptPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
}

function registerSessionArtifacts(
  context: DbContext,
  projectId: string,
  taskId: string,
  attemptId: string | undefined,
  artifacts: AgentSessionRuntimeResult["artifacts"]
): void {
  for (const [kind, path] of [
    ["agent-prompt", artifacts.promptPath],
    ["surface-json", artifacts.surfaceJsonPath],
    ["surface-markdown", artifacts.surfaceMarkdownPath],
    ["agent-transcript", artifacts.transcriptPath],
    ["agent-final-response", artifacts.finalResponsePath]
  ] as const) {
    createArtifact(context, {
      projectId,
      taskId,
      attemptId,
      kind,
      owner: "agent-provider-runtime",
      path
    });
  }
}

function assertAgentOperationCanRun(status: string): void {
  if (status === "succeeded" || status === "reconciled" || status === "canceled") {
    throw new AgentProviderRuntimeError(`operation is terminal: ${status}`);
  }
}

function normalizeFinalResponse(value: string): string {
  const normalized = value.trim();
  return normalized.length > 0 ? `${normalized}\n` : "provider returned empty response\n";
}

function normalizeRequestId(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new AgentProviderRuntimeError("requestId 不能为空");
  }
  return normalized.replace(/[^A-Za-z0-9._:-]+/g, "-");
}

function requireTaskRecord(context: DbContext, taskId: string): TaskRecord {
  const task = getTask(context, taskId);
  if (!task) {
    throw new AgentProviderRuntimeError(`task not found: ${taskId}`);
  }
  return task;
}

function requireProjectRecord(context: DbContext, projectId: string): ProjectRecord {
  const project = getProject(context, projectId);
  if (!project) {
    throw new AgentProviderRuntimeError(`project not found: ${projectId}`);
  }
  return project;
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function runCommand(command: string, args: string[], options: { cwd: string; input: string; timeoutMs: number }): string {
  try {
    return execFileSync(command, args, {
      cwd: options.cwd,
      input: options.input,
      encoding: "utf8",
      timeout: options.timeoutMs,
      maxBuffer: 10 * 1024 * 1024
    });
  } catch (error) {
    throw new ProviderUnavailableError(
      `agent provider command failed: ${command}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
