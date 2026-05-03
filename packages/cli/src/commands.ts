import { listTaskEvents, runMigrations, withDatabase } from "@coordinator/db";
import { getHealthStatus } from "@coordinator/shared";

export type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export function runCli(args: string[]): CliResult {
  const [command, ...rest] = args;

  if (!command || command === "health") {
    return {
      exitCode: 0,
      stdout: `${JSON.stringify(getHealthStatus())}\n`,
      stderr: ""
    };
  }

  if (command === "migrate") {
    const databasePathResult = readOption(rest, "--db");
    if (databasePathResult.error) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `${databasePathResult.error}\n`
      };
    }

    const databasePath = databasePathResult.value ?? process.env.COORDINATOR_DB_PATH ?? "coordinator.sqlite";
    const summary = runMigrations(databasePath);
    return {
      exitCode: 0,
      stdout: `${JSON.stringify(summary)}\n`,
      stderr: ""
    };
  }

  if (command === "timeline") {
    const databasePathResult = readRequiredOption(rest, "--db");
    const taskIdResult = readRequiredOption(rest, "--task");
    const error = databasePathResult.error ?? taskIdResult.error;
    if (error) {
      return { exitCode: 1, stdout: "", stderr: `${error}\n` };
    }

    const databasePath = databasePathResult.value;
    const taskId = taskIdResult.value;
    if (!databasePath || !taskId) {
      return { exitCode: 1, stdout: "", stderr: "timeline 参数不完整\n" };
    }

    const events = withDatabase(databasePath, (context) => listTaskEvents(context, taskId));
    return {
      exitCode: 0,
      stdout: `${JSON.stringify({ taskId, events })}\n`,
      stderr: ""
    };
  }

  return {
    exitCode: 1,
    stdout: "",
    stderr: `未知命令：${command}\n可用命令：health, migrate --db <path>, timeline --db <path> --task <task-id>\n`
  };
}

function readOption(args: string[], name: string): { value?: string; error?: string } {
  const index = args.indexOf(name);
  if (index === -1) {
    return {};
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    return { error: `缺少 ${name} 参数值` };
  }
  return { value };
}

function readRequiredOption(args: string[], name: string): { value: string; error?: never } | { value?: never; error: string } {
  const result = readOption(args, name);
  if (result.error) {
    return { error: result.error };
  }
  if (!result.value) {
    return { error: `缺少 ${name} 参数` };
  }
  return { value: result.value };
}
