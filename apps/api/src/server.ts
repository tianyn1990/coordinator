import Fastify, { type FastifyInstance } from "fastify";
import { ActiveResourceConflictError, listTaskEvents, withDatabase } from "@coordinator/db";
import {
  AgentProviderRuntimeError,
  CoordinatorAgentToolError,
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
  runCoordinatorAgentSession,
  startWorkflowRun,
  viewProjectRegistry,
  type GitProviderKind
} from "@coordinator/core";
import { getHealthStatus } from "@coordinator/shared";

export function buildServer(): FastifyInstance {
  const server = Fastify({ logger: true });

  server.get("/health", async () => getHealthStatus());
  server.get<{ Params: { taskId: string } }>("/tasks/:taskId/timeline", async (request, reply) => {
    const databasePath = process.env.COORDINATOR_DB_PATH;
    if (!databasePath) {
      return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
    }

    const events = withDatabase(databasePath, (context) => listTaskEvents(context, request.params.taskId));
    return { taskId: request.params.taskId, events };
  });
  server.get<{ Params: { taskId: string } }>("/tasks/:taskId/surface", async (request, reply) => {
    const databasePath = process.env.COORDINATOR_DB_PATH;
    if (!databasePath) {
      return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
    }

    const surface = withDatabase(databasePath, (context) => buildTaskSurfaceFromDb(context, request.params.taskId));
    return surface;
  });
  server.get("/projects", async (_request, reply) => {
    const databasePath = process.env.COORDINATOR_DB_PATH;
    if (!databasePath) {
      return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
    }

    const projects = withDatabase(databasePath, (context) => viewProjectRegistry(context));
    return { projects };
  });
  server.get<{ Params: { projectId: string } }>("/projects/:projectId", async (request, reply) => {
    const databasePath = process.env.COORDINATOR_DB_PATH;
    if (!databasePath) {
      return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
    }

    const projects = withDatabase(databasePath, (context) => viewProjectRegistry(context, request.params.projectId));
    return { projects };
  });
  server.post<{
    Body: RegisterProjectBody;
  }>(
    "/projects/register",
    {
      schema: {
        body: {
          type: "object",
          required: ["repoPath"],
          additionalProperties: false,
          properties: {
            repoPath: { type: "string", minLength: 1 },
            name: { type: "string", minLength: 1 },
            providerOverride: { type: "string", enum: ["github", "gitlab"] },
            confirmedDefaultBranch: { type: "string", minLength: 1 },
            workflowLauncher: { type: "string", minLength: 1 },
            outerAgentDefaultProvider: { type: "string", minLength: 1 },
            innerAgentDefaultProvider: { type: "string", minLength: 1 },
            workspaceRoot: { type: "string", minLength: 1 }
          }
        }
      }
    },
    async (request, reply) => {
      const databasePath = process.env.COORDINATOR_DB_PATH;
      if (!databasePath) {
        return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
      }

      try {
        const result = withDatabase(databasePath, (context) => registerProject(context, request.body));
        return result;
      } catch (error) {
        if (error instanceof ProjectRegistryInputError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    }
  );

  server.post<{
    Params: { attemptId: string };
    Body: CreateWorkspaceBody;
  }>(
    "/attempts/:attemptId/workspace",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            owner: { type: "string", minLength: 1 }
          }
        }
      }
    },
    async (request, reply) => {
      const databasePath = process.env.COORDINATOR_DB_PATH;
      if (!databasePath) {
        return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
      }

      try {
        return withDatabase(databasePath, (context) =>
          createAttemptWorkspace(context, {
            attemptId: request.params.attemptId,
            owner: request.body.owner ?? "api"
          })
        );
      } catch (error) {
        if (error instanceof WorkspaceManagerError || error instanceof ActiveResourceConflictError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    }
  );

  server.get<{ Params: { workspaceId: string } }>("/workspaces/:workspaceId/preflight", async (request, reply) => {
    const databasePath = process.env.COORDINATOR_DB_PATH;
    if (!databasePath) {
      return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
    }

    return withDatabase(databasePath, (context) =>
      resumeWorkspacePreflight(context, { workspaceId: request.params.workspaceId })
    );
  });

  server.get<{ Params: { projectId: string } }>("/projects/:projectId/workflow/capabilities", async (request, reply) => {
    const databasePath = process.env.COORDINATOR_DB_PATH;
    if (!databasePath) {
      return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
    }

    try {
      return withDatabase(databasePath, (context) =>
        inspectWorkflowCapabilities(context, { projectId: request.params.projectId })
      );
    } catch (error) {
      if (error instanceof WorkflowProtocolError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
  });

  server.post<{
    Params: { attemptId: string };
    Body: StartWorkflowBody;
  }>(
    "/attempts/:attemptId/workflow-runs",
    {
      schema: {
        body: {
          type: "object",
          required: ["profileId"],
          additionalProperties: false,
          properties: {
            profileId: { type: "string", minLength: 1 },
            owner: { type: "string", minLength: 1 }
          }
        }
      }
    },
    async (request, reply) => {
      const databasePath = process.env.COORDINATOR_DB_PATH;
      if (!databasePath) {
        return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
      }

      try {
        return withDatabase(databasePath, (context) =>
          startWorkflowRun(context, {
            attemptId: request.params.attemptId,
            profileId: request.body.profileId,
            owner: request.body.owner ?? "api"
          })
        );
      } catch (error) {
        if (error instanceof WorkflowProtocolError || error instanceof ActiveResourceConflictError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    }
  );

  server.get<{ Params: { workflowRunId: string } }>("/workflow-runs/:workflowRunId/status", async (request, reply) => {
    const databasePath = process.env.COORDINATOR_DB_PATH;
    if (!databasePath) {
      return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
    }

    try {
      return withDatabase(databasePath, (context) =>
        inspectWorkflowRun(context, { workflowRunId: request.params.workflowRunId })
      );
    } catch (error) {
      if (error instanceof WorkflowProtocolError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
  });

  server.post<{
    Params: { workflowRunId: string };
    Body: WorkflowActionBody;
  }>(
    "/workflow-runs/:workflowRunId/action",
    {
      schema: {
        body: {
          type: "object",
          required: ["action", "expectedStateVersion"],
          additionalProperties: false,
          properties: {
            action: { type: "string", minLength: 1 },
            arg: { type: "string", minLength: 1 },
            expectedStateVersion: { type: "integer", minimum: 0 }
          }
        }
      }
    },
    async (request, reply) => {
      const databasePath = process.env.COORDINATOR_DB_PATH;
      if (!databasePath) {
        return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
      }

      try {
        return withDatabase(databasePath, (context) =>
          invokeWorkflowAction(context, {
            workflowRunId: request.params.workflowRunId,
            action: request.body.action,
            expectedStateVersion: request.body.expectedStateVersion,
            arg: request.body.arg
          })
        );
      } catch (error) {
        if (error instanceof WorkflowProtocolError || error instanceof ActiveResourceConflictError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    }
  );

  server.get<{ Params: { workflowRunId: string } }>("/workflow-runs/:workflowRunId/artifacts", async (request, reply) => {
    const databasePath = process.env.COORDINATOR_DB_PATH;
    if (!databasePath) {
      return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
    }

    try {
      return withDatabase(databasePath, (context) =>
        listWorkflowArtifacts(context, { workflowRunId: request.params.workflowRunId })
      );
    } catch (error) {
      if (error instanceof WorkflowProtocolError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
  });

  server.get<{ Params: { workflowRunId: string } }>("/workflow-runs/:workflowRunId/events", async (request, reply) => {
    const databasePath = process.env.COORDINATOR_DB_PATH;
    if (!databasePath) {
      return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
    }

    try {
      return withDatabase(databasePath, (context) =>
        listWorkflowEvents(context, { workflowRunId: request.params.workflowRunId })
      );
    } catch (error) {
      if (error instanceof WorkflowProtocolError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
  });

  server.post<{
    Params: { taskId: string };
    Body: RunAgentSessionBody;
  }>(
    "/tasks/:taskId/agent-sessions",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            providerId: { type: "string", minLength: 1 },
            requestId: { type: "string", minLength: 1 },
            timeoutMs: { type: "integer", minimum: 1 }
          }
        }
      }
    },
    async (request, reply) => {
      const databasePath = process.env.COORDINATOR_DB_PATH;
      if (!databasePath) {
        return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
      }

      try {
        return withDatabase(databasePath, (context) =>
          runCoordinatorAgentSession(context, {
            taskId: request.params.taskId,
            providerId: request.body.providerId,
            requestId: request.body.requestId,
            timeoutMs: request.body.timeoutMs
          })
        );
      } catch (error) {
        if (error instanceof AgentProviderRuntimeError || error instanceof ActiveResourceConflictError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    }
  );

  server.get<{ Params: { agentSessionId: string } }>("/agent-sessions/:agentSessionId", async (request, reply) => {
    const databasePath = process.env.COORDINATOR_DB_PATH;
    if (!databasePath) {
      return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
    }

    try {
      return withDatabase(databasePath, (context) =>
        inspectAgentSession(context, { agentSessionId: request.params.agentSessionId })
      );
    } catch (error) {
      if (error instanceof AgentProviderRuntimeError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
  });

  server.post<{
    Params: { taskId: string };
    Body: ExecuteAgentToolBody;
  }>(
    "/tasks/:taskId/agent-tools",
    {
      schema: {
        body: {
          type: "object",
          required: ["toolName"],
          additionalProperties: false,
          properties: {
            toolName: { type: "string", minLength: 1 },
            actor: { type: "string", minLength: 1 },
            agentSessionId: { type: "string", minLength: 1 },
            args: {
              type: "object",
              additionalProperties: { type: "string" }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const databasePath = process.env.COORDINATOR_DB_PATH;
      if (!databasePath) {
        return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
      }

      try {
        return withDatabase(databasePath, (context) =>
          executeCoordinatorAgentTool(context, {
            taskId: request.params.taskId,
            toolName: request.body.toolName,
            actor: request.body.actor ?? "api",
            agentSessionId: request.body.agentSessionId,
            args: request.body.args
          })
        );
      } catch (error) {
        if (
          error instanceof CoordinatorAgentToolError ||
          error instanceof WorkspaceManagerError ||
          error instanceof WorkflowProtocolError ||
          error instanceof ActiveResourceConflictError
        ) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    }
  );

  return server;
}

type RegisterProjectBody = {
  repoPath: string;
  name?: string;
  providerOverride?: GitProviderKind;
  confirmedDefaultBranch?: string;
  workflowLauncher?: string;
  outerAgentDefaultProvider?: string;
  innerAgentDefaultProvider?: string;
  workspaceRoot?: string;
};

type CreateWorkspaceBody = {
  owner?: string;
};

type StartWorkflowBody = {
  profileId: string;
  owner?: string;
};

type WorkflowActionBody = {
  action: string;
  expectedStateVersion: number;
  arg?: string;
};

type RunAgentSessionBody = {
  providerId?: string;
  requestId?: string;
  timeoutMs?: number;
};

type ExecuteAgentToolBody = {
  toolName: string;
  actor?: string;
  agentSessionId?: string;
  args?: Record<string, string>;
};
