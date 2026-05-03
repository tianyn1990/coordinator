import { runMigrations } from "@coordinator/db";
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

  return {
    exitCode: 1,
    stdout: "",
    stderr: `未知命令：${command}\n可用命令：health, migrate --db <path>\n`
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
