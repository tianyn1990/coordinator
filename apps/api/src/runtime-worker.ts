import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { AgentSessionRuntimeResult, DaemonTickResult } from "@coordinator/core";

const RESULT_PREFIX = "__COORDINATOR_API_RUNTIME_RESULT__";
const DEFAULT_RUNTIME_WORKER_TIMEOUT_MS = 12 * 60 * 1000;
const WORKER_KILL_GRACE_MS = 5_000;
const requireFromApi = createRequire(import.meta.url);
const DB_MODULE_URL = pathToFileURL(requireFromApi.resolve("@coordinator/db")).href;
const CORE_MODULE_URL = pathToFileURL(requireFromApi.resolve("@coordinator/core")).href;

type DaemonTickWorkerInput = {
  owner?: string;
  taskId?: string;
  retryBudget?: number;
  candidateLimit?: number;
};

type AgentSessionWorkerInput = {
  taskId: string;
  providerId?: string;
  requestId?: string;
  timeoutMs?: number;
};

type RuntimeWorkerRequest =
  | {
      action: "daemonTick";
      databasePath: string;
      input: DaemonTickWorkerInput;
    }
  | {
      action: "agentSession";
      databasePath: string;
      input: AgentSessionWorkerInput;
    };

type RuntimeWorkerEnvelope<T> =
  | { ok: true; result: T }
  | {
      ok: false;
      error: {
        name?: string;
        message: string;
        stack?: string;
      };
    };

export interface RuntimeExecutor {
  runDaemonTick(databasePath: string, input: DaemonTickWorkerInput): Promise<DaemonTickResult>;
  runCoordinatorAgentSession(
    databasePath: string,
    input: AgentSessionWorkerInput
  ): Promise<AgentSessionRuntimeResult>;
}

export class RuntimeWorkerError extends Error {
  readonly remoteName?: string;
  readonly exitCode?: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly stderr?: string;
  readonly timedOut: boolean;

  constructor(
    message: string,
    options: {
      remoteName?: string;
      exitCode?: number | null;
      signal?: NodeJS.Signals | null;
      stderr?: string;
      stack?: string;
      timedOut?: boolean;
    } = {}
  ) {
    super(message);
    this.name = "RuntimeWorkerError";
    this.remoteName = options.remoteName;
    this.exitCode = options.exitCode;
    this.signal = options.signal;
    this.stderr = options.stderr;
    this.timedOut = options.timedOut ?? false;
    if (options.stack) {
      this.stack = options.stack;
    }
  }
}

export function createRuntimeWorkerExecutor(): RuntimeExecutor {
  return {
    runDaemonTick(databasePath, input) {
      return runRuntimeWorker<DaemonTickResult>({ action: "daemonTick", databasePath, input });
    },
    runCoordinatorAgentSession(databasePath, input) {
      return runRuntimeWorker<AgentSessionRuntimeResult>({ action: "agentSession", databasePath, input });
    }
  };
}

export function isRuntimeWorkerErrorNamed(error: unknown, names: readonly string[]): boolean {
  if (!(error instanceof RuntimeWorkerError)) {
    return false;
  }
  return error.remoteName !== undefined && names.includes(error.remoteName);
}

export function isRuntimeWorkerTimeout(error: unknown): boolean {
  return error instanceof RuntimeWorkerError && error.timedOut;
}

function runRuntimeWorker<T>(request: RuntimeWorkerRequest): Promise<T> {
  const timeoutMs = resolveRuntimeWorkerTimeoutMs(request);

  return new Promise((resolve, reject) => {
    // provider SDK/CLI 可能长时间同步阻塞；必须放入独立进程，避免 API event loop 被卡死。
    const child = spawn(process.execPath, ["--input-type=module", "-e", RUNTIME_WORKER_SCRIPT], {
      cwd: process.cwd(),
      detached: process.platform !== "win32",
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminateRuntimeWorker(child.pid, "SIGTERM");
      killTimer = setTimeout(() => terminateRuntimeWorker(child.pid, "SIGKILL"), WORKER_KILL_GRACE_MS);
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeoutTimer);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeoutTimer);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      // worker 退出后仍可能留下 provider SDK/CLI 子孙进程；关闭同进程组避免 orphan 污染后续任务。
      cleanupRuntimeWorkerGroup(child.pid);
      if (timedOut) {
        reject(
          new RuntimeWorkerError(`runtime worker timed out after ${timeoutMs}ms`, {
            exitCode: code,
            signal,
            stderr: tail(stderr),
            timedOut: true
          })
        );
        return;
      }

      try {
        const envelope = parseRuntimeWorkerEnvelope<T>(stdout);
        if (!envelope.ok) {
          reject(
            new RuntimeWorkerError(envelope.error.message, {
              remoteName: envelope.error.name,
              exitCode: code,
              signal,
              stderr: tail(stderr),
              stack: envelope.error.stack
            })
          );
          return;
        }
        resolve(envelope.result);
      } catch (error) {
        reject(
          new RuntimeWorkerError(
            `runtime worker failed${code === null ? "" : ` with exit code ${code}`}: ${
              error instanceof Error ? error.message : String(error)
            }`,
            { exitCode: code, signal, stderr: tail(stderr) }
          )
        );
      }
    });

    child.stdin.end(JSON.stringify(request));
  });
}

function parseRuntimeWorkerEnvelope<T>(stdout: string): RuntimeWorkerEnvelope<T> {
  const line = stdout
    .split(/\r?\n/)
    .reverse()
    .find((entry) => entry.startsWith(RESULT_PREFIX));
  if (!line) {
    throw new Error("missing runtime worker result");
  }
  return JSON.parse(line.slice(RESULT_PREFIX.length)) as RuntimeWorkerEnvelope<T>;
}

function resolveRuntimeWorkerTimeoutMs(request: RuntimeWorkerRequest): number {
  const configured = Number(process.env.COORDINATOR_API_RUNTIME_WORKER_TIMEOUT_MS);
  if (Number.isInteger(configured) && configured > 0) {
    return configured;
  }
  if (request.action === "agentSession" && request.input.timeoutMs !== undefined) {
    return Math.max(DEFAULT_RUNTIME_WORKER_TIMEOUT_MS, request.input.timeoutMs + 60_000);
  }
  return DEFAULT_RUNTIME_WORKER_TIMEOUT_MS;
}

function terminateRuntimeWorker(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) {
    return;
  }
  try {
    if (process.platform !== "win32") {
      process.kill(-pid, signal);
      return;
    }
    process.kill(pid, signal);
  } catch {
    // 进程可能已自然退出；清理阶段不再把 ESRCH 之类的竞态上抛给 API。
  }
}

function cleanupRuntimeWorkerGroup(pid: number | undefined): void {
  terminateRuntimeWorker(pid, "SIGTERM");
  const cleanupKillTimer = setTimeout(() => terminateRuntimeWorker(pid, "SIGKILL"), WORKER_KILL_GRACE_MS);
  cleanupKillTimer.unref();
}

function tail(value: string, maxLength = 4000): string | undefined {
  if (value.length === 0) {
    return undefined;
  }
  return value.length <= maxLength ? value : value.slice(-maxLength);
}

const RUNTIME_WORKER_SCRIPT = String.raw`
const RESULT_PREFIX = ${JSON.stringify(RESULT_PREFIX)};

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name && error.name !== "Error" ? error.name : error.constructor?.name,
      message: error.message,
      stack: error.stack
    };
  }
  return { message: String(error) };
}

async function readStdin() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return input;
}

async function main() {
  const request = JSON.parse(await readStdin());
  const [{ withDatabase }, core] = await Promise.all([
    import(${JSON.stringify(DB_MODULE_URL)}),
    import(${JSON.stringify(CORE_MODULE_URL)})
  ]);

  let result;
  if (request.action === "daemonTick") {
    result = withDatabase(request.databasePath, (context) => core.runDaemonTick(context, request.input ?? {}));
  } else if (request.action === "agentSession") {
    result = withDatabase(request.databasePath, (context) =>
      core.runCoordinatorAgentSession(context, request.input ?? {})
    );
  } else {
    throw new Error("unsupported runtime worker action: " + request.action);
  }

  process.stdout.write(RESULT_PREFIX + JSON.stringify({ ok: true, result }) + "\n");
}

main().catch((error) => {
  process.stdout.write(RESULT_PREFIX + JSON.stringify({ ok: false, error: serializeError(error) }) + "\n");
});
`;
