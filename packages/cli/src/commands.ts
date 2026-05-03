import { ActiveResourceConflictError, listTaskEvents, runMigrations, withDatabase } from "@coordinator/db";
import {
  AgentProviderRuntimeError,
  CoordinatorAgentToolError,
  DaemonRuntimeError,
  ProjectRegistryInputError,
  WorkspaceManagerError,
  WorkflowProtocolError,
  buildTaskSurfaceFromDb,
  createAttemptWorkspace,
  executeCoordinatorAgentTool,
  inspectAgentSession,
  inspectWorkflowCapabilities,
  inspectWorkflowRun,
  invokeWorkflowAction,
  listWorkflowArtifacts,
  listWorkflowEvents,
  registerProject,
  resumeWorkspacePreflight,
  runDaemonTick,
  runCoordinatorAgentSession,
  startWorkflowRun,
  viewProjectRegistry
} from "@coordinator/core";
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

  if (command === "surface") {
    const databasePathResult = readRequiredOption(rest, "--db");
    const taskIdResult = readRequiredOption(rest, "--task");
    const formatResult = readOption(rest, "--format");
    const error = databasePathResult.error ?? taskIdResult.error ?? formatResult.error;
    if (error) {
      return { exitCode: 1, stdout: "", stderr: `${error}\n` };
    }

    const databasePath = databasePathResult.value;
    const taskId = taskIdResult.value;
    const format = formatResult.value ?? "json";
    if (!databasePath || !taskId) {
      return { exitCode: 1, stdout: "", stderr: "surface 参数不完整\n" };
    }
    if (format !== "json" && format !== "markdown") {
      return { exitCode: 1, stdout: "", stderr: `不支持的 surface format：${format}\n` };
    }

    const surface = withDatabase(databasePath, (context) => buildTaskSurfaceFromDb(context, taskId));
    return {
      exitCode: 0,
      stdout: format === "markdown" ? surface.markdown : `${JSON.stringify(surface.json)}\n`,
      stderr: ""
    };
  }

  if (command === "register") {
    const databasePathResult = readRequiredOption(rest, "--db");
    const repoPathResult = readRequiredOption(rest, "--repo");
    const confirmedDefaultBranchResult = readOption(rest, "--default-branch");
    const providerOptionResult = readOption(rest, "--provider");
    const error =
      databasePathResult.error ?? repoPathResult.error ?? confirmedDefaultBranchResult.error ?? providerOptionResult.error;
    if (error) {
      return { exitCode: 1, stdout: "", stderr: `${error}\n` };
    }

    const databasePath = databasePathResult.value;
    const repoPath = repoPathResult.value;
    const confirmedDefaultBranch = confirmedDefaultBranchResult.value;
    const providerResult = parseProvider(providerOptionResult.value ?? undefined);
    if (!databasePath || !repoPath) {
      return { exitCode: 1, stdout: "", stderr: "register 参数不完整\n" };
    }
    if (providerResult.error) {
      return { exitCode: 1, stdout: "", stderr: `${providerResult.error}\n` };
    }

    try {
      const result = withDatabase(databasePath, (context) =>
        registerProject(context, {
          repoPath,
          name: readOption(rest, "--name").value ?? undefined,
          providerOverride: providerResult.value,
          confirmedDefaultBranch: confirmedDefaultBranch ?? undefined,
          workflowLauncher: readOption(rest, "--workflow-launcher").value ?? undefined,
          outerAgentDefaultProvider: readOption(rest, "--outer-agent-provider").value ?? undefined,
          innerAgentDefaultProvider: readOption(rest, "--inner-agent-provider").value ?? undefined,
          workspaceRoot: readOption(rest, "--workspace-root").value ?? undefined
        })
      );

      return {
        exitCode: 0,
        stdout: `${JSON.stringify(result)}\n`,
        stderr: ""
      };
    } catch (error) {
      if (error instanceof ProjectRegistryInputError) {
        return { exitCode: 1, stdout: "", stderr: `${error.message}\n` };
      }
      throw error;
    }
  }

  if (command === "projects") {
    const databasePathResult = readRequiredOption(rest, "--db");
    if (databasePathResult.error) {
      return { exitCode: 1, stdout: "", stderr: `${databasePathResult.error}\n` };
    }
    const databasePath = databasePathResult.value;
    if (!databasePath) {
      return { exitCode: 1, stdout: "", stderr: "projects 参数不完整\n" };
    }
    const projectId = readOption(rest, "--project").value ?? undefined;
    const projects = withDatabase(databasePath, (context) =>
      viewProjectRegistry(context, projectId)
    );
    return {
      exitCode: 0,
      stdout: `${JSON.stringify({ projects })}\n`,
      stderr: ""
    };
  }

  if (command === "workspace") {
    const [subcommand, ...workspaceArgs] = rest;
    if (subcommand === "create") {
      const databasePathResult = readRequiredOption(workspaceArgs, "--db");
      const attemptIdResult = readRequiredOption(workspaceArgs, "--attempt");
      const ownerResult = readOption(workspaceArgs, "--owner");
      const error = databasePathResult.error ?? attemptIdResult.error ?? ownerResult.error;
      if (error) {
        return { exitCode: 1, stdout: "", stderr: `${error}\n` };
      }
      const databasePath = databasePathResult.value;
      const attemptId = attemptIdResult.value;
      const owner = ownerResult.value ?? "cli";
      if (!databasePath || !attemptId) {
        return { exitCode: 1, stdout: "", stderr: "workspace create 参数不完整\n" };
      }
      try {
        const result = withDatabase(databasePath, (context) =>
          createAttemptWorkspace(context, { attemptId, owner })
        );
        return { exitCode: 0, stdout: `${JSON.stringify(result)}\n`, stderr: "" };
      } catch (error) {
        if (error instanceof WorkspaceManagerError || error instanceof ActiveResourceConflictError) {
          return { exitCode: 1, stdout: "", stderr: `${error.message}\n` };
        }
        throw error;
      }
    }

    if (subcommand === "preflight") {
      const databasePathResult = readRequiredOption(workspaceArgs, "--db");
      const workspaceIdResult = readRequiredOption(workspaceArgs, "--workspace");
      const error = databasePathResult.error ?? workspaceIdResult.error;
      if (error) {
        return { exitCode: 1, stdout: "", stderr: `${error}\n` };
      }
      const databasePath = databasePathResult.value;
      const workspaceId = workspaceIdResult.value;
      if (!databasePath || !workspaceId) {
        return { exitCode: 1, stdout: "", stderr: "workspace preflight 参数不完整\n" };
      }
      const result = withDatabase(databasePath, (context) => resumeWorkspacePreflight(context, { workspaceId }));
      return { exitCode: 0, stdout: `${JSON.stringify(result)}\n`, stderr: "" };
    }

    return {
      exitCode: 1,
      stdout: "",
      stderr: "未知 workspace 子命令，可用：workspace create, workspace preflight\n"
    };
  }

  if (command === "workflow") {
    const [subcommand, ...workflowArgs] = rest;
    try {
      if (subcommand === "capabilities") {
        const databasePathResult = readRequiredOption(workflowArgs, "--db");
        const projectIdResult = readRequiredOption(workflowArgs, "--project");
        const error = databasePathResult.error ?? projectIdResult.error;
        if (error) {
          return { exitCode: 1, stdout: "", stderr: `${error}\n` };
        }
        const databasePath = databasePathResult.value;
        const projectId = projectIdResult.value;
        if (!databasePath || !projectId) {
          return { exitCode: 1, stdout: "", stderr: "workflow capabilities 参数不完整\n" };
        }
        const result = withDatabase(databasePath, (context) =>
          inspectWorkflowCapabilities(context, { projectId })
        );
        return { exitCode: 0, stdout: `${JSON.stringify(result)}\n`, stderr: "" };
      }

      if (subcommand === "start") {
        const databasePathResult = readRequiredOption(workflowArgs, "--db");
        const attemptIdResult = readRequiredOption(workflowArgs, "--attempt");
        const profileResult = readRequiredOption(workflowArgs, "--profile");
        const ownerResult = readOption(workflowArgs, "--owner");
        const error = databasePathResult.error ?? attemptIdResult.error ?? profileResult.error ?? ownerResult.error;
        if (error) {
          return { exitCode: 1, stdout: "", stderr: `${error}\n` };
        }
        const databasePath = databasePathResult.value;
        const attemptId = attemptIdResult.value;
        const profileId = profileResult.value;
        if (!databasePath || !attemptId || !profileId) {
          return { exitCode: 1, stdout: "", stderr: "workflow start 参数不完整\n" };
        }
        const result = withDatabase(databasePath, (context) =>
          startWorkflowRun(context, {
            attemptId,
            profileId,
            owner: ownerResult.value ?? "cli"
          })
        );
        return { exitCode: 0, stdout: `${JSON.stringify(result)}\n`, stderr: "" };
      }

      if (subcommand === "status") {
        const databasePathResult = readRequiredOption(workflowArgs, "--db");
        const workflowRunIdResult = readRequiredOption(workflowArgs, "--run");
        const error = databasePathResult.error ?? workflowRunIdResult.error;
        if (error) {
          return { exitCode: 1, stdout: "", stderr: `${error}\n` };
        }
        const databasePath = databasePathResult.value;
        const workflowRunId = workflowRunIdResult.value;
        if (!databasePath || !workflowRunId) {
          return { exitCode: 1, stdout: "", stderr: "workflow status 参数不完整\n" };
        }
        const result = withDatabase(databasePath, (context) =>
          inspectWorkflowRun(context, { workflowRunId })
        );
        return { exitCode: 0, stdout: `${JSON.stringify(result)}\n`, stderr: "" };
      }

      if (subcommand === "action") {
        const databasePathResult = readRequiredOption(workflowArgs, "--db");
        const workflowRunIdResult = readRequiredOption(workflowArgs, "--run");
        const actionResult = readRequiredOption(workflowArgs, "--action");
        const expectedVersionResult = readRequiredOption(workflowArgs, "--expected-version");
        const argResult = readOption(workflowArgs, "--arg");
        const error =
          databasePathResult.error ?? workflowRunIdResult.error ?? actionResult.error ?? expectedVersionResult.error ?? argResult.error;
        if (error) {
          return { exitCode: 1, stdout: "", stderr: `${error}\n` };
        }
        const databasePath = databasePathResult.value;
        const workflowRunId = workflowRunIdResult.value;
        const action = actionResult.value;
        const expectedStateVersion = Number(expectedVersionResult.value);
        if (!databasePath || !workflowRunId || !action || !Number.isInteger(expectedStateVersion) || expectedStateVersion < 0) {
          return { exitCode: 1, stdout: "", stderr: "workflow action 参数不完整\n" };
        }
        const result = withDatabase(databasePath, (context) =>
          invokeWorkflowAction(context, {
            workflowRunId,
            action,
            expectedStateVersion,
            arg: argResult.value
          })
        );
        return { exitCode: 0, stdout: `${JSON.stringify(result)}\n`, stderr: "" };
      }

      if (subcommand === "artifacts") {
        const databasePathResult = readRequiredOption(workflowArgs, "--db");
        const workflowRunIdResult = readRequiredOption(workflowArgs, "--run");
        const error = databasePathResult.error ?? workflowRunIdResult.error;
        if (error) {
          return { exitCode: 1, stdout: "", stderr: `${error}\n` };
        }
        const databasePath = databasePathResult.value;
        const workflowRunId = workflowRunIdResult.value;
        if (!databasePath || !workflowRunId) {
          return { exitCode: 1, stdout: "", stderr: "workflow artifacts 参数不完整\n" };
        }
        const result = withDatabase(databasePath, (context) =>
          listWorkflowArtifacts(context, { workflowRunId })
        );
        return { exitCode: 0, stdout: `${JSON.stringify(result)}\n`, stderr: "" };
      }

      if (subcommand === "events") {
        const databasePathResult = readRequiredOption(workflowArgs, "--db");
        const workflowRunIdResult = readRequiredOption(workflowArgs, "--run");
        const error = databasePathResult.error ?? workflowRunIdResult.error;
        if (error) {
          return { exitCode: 1, stdout: "", stderr: `${error}\n` };
        }
        const databasePath = databasePathResult.value;
        const workflowRunId = workflowRunIdResult.value;
        if (!databasePath || !workflowRunId) {
          return { exitCode: 1, stdout: "", stderr: "workflow events 参数不完整\n" };
        }
        const result = withDatabase(databasePath, (context) =>
          listWorkflowEvents(context, { workflowRunId })
        );
        return { exitCode: 0, stdout: `${JSON.stringify(result)}\n`, stderr: "" };
      }
    } catch (error) {
      if (error instanceof WorkflowProtocolError || error instanceof ActiveResourceConflictError) {
        return { exitCode: 1, stdout: "", stderr: `${error.message}\n` };
      }
      throw error;
    }

    return {
      exitCode: 1,
      stdout: "",
      stderr: "未知 workflow 子命令，可用：workflow capabilities, workflow start, workflow status, workflow action, workflow artifacts, workflow events\n"
    };
  }

  if (command === "agent") {
    const [subcommand, ...agentArgs] = rest;
    try {
      if (subcommand === "run") {
        const databasePathResult = readRequiredOption(agentArgs, "--db");
        const taskIdResult = readRequiredOption(agentArgs, "--task");
        const providerResult = readOption(agentArgs, "--provider");
        const requestIdResult = readOption(agentArgs, "--request-id");
        const timeoutResult = readOption(agentArgs, "--timeout-ms");
        const error = databasePathResult.error ?? taskIdResult.error ?? providerResult.error ?? requestIdResult.error ?? timeoutResult.error;
        if (error) {
          return { exitCode: 1, stdout: "", stderr: `${error}\n` };
        }
        const databasePath = databasePathResult.value;
        const taskId = taskIdResult.value;
        let timeoutMs: number | undefined;
        if (timeoutResult.value !== undefined) {
          const parsedTimeoutMs = Number(timeoutResult.value);
          if (!Number.isInteger(parsedTimeoutMs) || parsedTimeoutMs <= 0) {
            return { exitCode: 1, stdout: "", stderr: "agent run 参数不完整\n" };
          }
          timeoutMs = parsedTimeoutMs;
        }
        if (!databasePath || !taskId) {
          return { exitCode: 1, stdout: "", stderr: "agent run 参数不完整\n" };
        }
        const result = withDatabase(databasePath, (context) =>
          runCoordinatorAgentSession(context, {
            taskId,
            providerId: providerResult.value ?? undefined,
            requestId: requestIdResult.value ?? undefined,
            timeoutMs
          })
        );
        return { exitCode: 0, stdout: `${JSON.stringify(result)}\n`, stderr: "" };
      }

      if (subcommand === "inspect") {
        const databasePathResult = readRequiredOption(agentArgs, "--db");
        const sessionIdResult = readRequiredOption(agentArgs, "--session");
        const error = databasePathResult.error ?? sessionIdResult.error;
        if (error) {
          return { exitCode: 1, stdout: "", stderr: `${error}\n` };
        }
        const databasePath = databasePathResult.value;
        const agentSessionId = sessionIdResult.value;
        if (!databasePath || !agentSessionId) {
          return { exitCode: 1, stdout: "", stderr: "agent inspect 参数不完整\n" };
        }
        const result = withDatabase(databasePath, (context) => inspectAgentSession(context, { agentSessionId }));
        return { exitCode: 0, stdout: `${JSON.stringify(result)}\n`, stderr: "" };
      }
    } catch (error) {
      if (error instanceof AgentProviderRuntimeError || error instanceof ActiveResourceConflictError) {
        return { exitCode: 1, stdout: "", stderr: `${error.message}\n` };
      }
      throw error;
    }

    return {
      exitCode: 1,
      stdout: "",
      stderr: "未知 agent 子命令，可用：agent run, agent inspect\n"
    };
  }

  if (command === "agent-tool") {
    const [subcommand, ...toolArgs] = rest;
    if (subcommand === "execute") {
      const databasePathResult = readRequiredOption(toolArgs, "--db");
      const taskIdResult = readRequiredOption(toolArgs, "--task");
      const toolNameResult = readRequiredOption(toolArgs, "--tool");
      const actorResult = readOption(toolArgs, "--actor");
      const agentSessionResult = readOption(toolArgs, "--agent-session");
      const error =
        databasePathResult.error ?? taskIdResult.error ?? toolNameResult.error ?? actorResult.error ?? agentSessionResult.error;
      if (error) {
        return { exitCode: 1, stdout: "", stderr: `${error}\n` };
      }
      const databasePath = databasePathResult.value;
      const taskId = taskIdResult.value;
      const toolName = toolNameResult.value;
      if (!databasePath || !taskId || !toolName) {
        return { exitCode: 1, stdout: "", stderr: "agent-tool execute 参数不完整\n" };
      }
      try {
        const result = withDatabase(databasePath, (context) =>
          executeCoordinatorAgentTool(context, {
            taskId,
            toolName,
            actor: actorResult.value ?? "cli",
            agentSessionId: agentSessionResult.value ?? undefined,
            args: parseToolArgs(toolArgs)
          })
        );
        return { exitCode: 0, stdout: `${JSON.stringify(result)}\n`, stderr: "" };
      } catch (error) {
        if (
          error instanceof CoordinatorAgentToolError ||
          error instanceof WorkspaceManagerError ||
          error instanceof WorkflowProtocolError ||
          error instanceof ActiveResourceConflictError
        ) {
          return { exitCode: 1, stdout: "", stderr: `${error.message}\n` };
        }
        throw error;
      }
    }

    return {
      exitCode: 1,
      stdout: "",
      stderr: "未知 agent-tool 子命令，可用：agent-tool execute\n"
    };
  }

  if (command === "daemon") {
    const [subcommand, ...daemonArgs] = rest;
    if (subcommand === "tick") {
      const databasePathResult = readRequiredOption(daemonArgs, "--db");
      const error = databasePathResult.error;
      if (error) {
        return { exitCode: 1, stdout: "", stderr: `${error}\n` };
      }
      const databasePath = databasePathResult.value;
      if (!databasePath) {
        return { exitCode: 1, stdout: "", stderr: "daemon tick 参数不完整\n" };
      }
      try {
        const retryBudgetOption = readOption(daemonArgs, "--retry-budget").value;
        if (retryBudgetOption !== undefined) {
          const parsed = Number(retryBudgetOption);
          if (!Number.isInteger(parsed) || parsed < 0) {
            return { exitCode: 1, stdout: "", stderr: "daemon tick 参数不完整\n" };
          }
        }
        const result = withDatabase(databasePath, (context) =>
          runDaemonTick(context, {
            owner: readOption(daemonArgs, "--owner").value ?? "cli",
            retryBudget: retryBudgetOption === undefined ? undefined : Number(retryBudgetOption)
          })
        );
        return { exitCode: 0, stdout: `${JSON.stringify(result)}\n`, stderr: "" };
      } catch (error) {
        if (error instanceof DaemonRuntimeError || error instanceof ActiveResourceConflictError) {
          return { exitCode: 1, stdout: "", stderr: `${error.message}\n` };
        }
        throw error;
      }
    }

    return {
      exitCode: 1,
      stdout: "",
      stderr: "未知 daemon 子命令，可用：daemon tick\n"
    };
  }

  return {
    exitCode: 1,
      stdout: "",
      stderr: `未知命令：${command}\n可用命令：health, migrate --db <path>, timeline --db <path> --task <task-id>, surface --db <path> --task <task-id>, register --db <path> --repo <path>, projects --db <path>, workspace create, workspace preflight, workflow <subcommand>, agent <subcommand>, agent-tool <subcommand>, daemon <subcommand>\n`
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

function parseProvider(value?: string): { value?: "github" | "gitlab"; error?: string } {
  if (value === undefined) {
    return {};
  }
  if (value === "github" || value === "gitlab") {
    return { value };
  }
  return { error: `不支持的 provider：${value}` };
}

function parseToolArgs(args: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--arg-")) {
      continue;
    }
    const key = token.slice("--arg-".length);
    const value = args[index + 1];
    if (!key || !value || value.startsWith("--")) {
      continue;
    }
    values[key] = value;
    index += 1;
  }
  return values;
}
