import Fastify, { type FastifyInstance } from "fastify";
import { listTaskEvents, withDatabase } from "@coordinator/db";
import { ProjectRegistryInputError, registerProject, viewProjectRegistry, type GitProviderKind } from "@coordinator/core";
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
  });

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
