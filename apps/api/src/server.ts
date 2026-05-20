import Fastify, { type FastifyInstance } from "fastify";
import { ActiveResourceConflictError, CasConflictError, listTaskEvents, withDatabase } from "@coordinator/db";
import {
  AgentProviderRuntimeError,
  CoordinatorAgentToolError,
  DaemonRuntimeError,
  OperatorSurfaceError,
  ProjectRegistryInputError,
  PullRequestProviderError,
  WorkspaceManagerError,
  WorkflowProtocolError,
  approveMergeRuntime,
  buildTaskSurfaceFromDb,
  controlTaskRuntime,
  createManualTask,
  createAttemptWorkspace,
  createPullRequestRuntime,
  executeCoordinatorAgentTool,
  getOperatorExecutionSummary,
  getOperatorTaskDetail,
  inspectAgentSession,
  inspectPullRequestReviewRuntime,
  inspectWorkflowCapabilities,
  inspectWorkflowRun,
  listOperatorTasks,
  invokeWorkflowAction,
  listWorkflowArtifacts,
  listWorkflowEvents,
  mergeAfterApprovalRuntime,
  recordHumanAnswerRuntime,
  registerProject,
  rejectMergeRuntime,
  requestMergeApprovalRuntime,
  resumeWorkspacePreflight,
  runDaemonTick,
  runCoordinatorAgentSession,
  startWorkflowRun,
  updatePullRequestRuntime,
  viewProjectRegistry,
  type GitProviderKind
} from "@coordinator/core";
import { getHealthStatus } from "@coordinator/shared";

export function buildServer(): FastifyInstance {
  const server = Fastify({ logger: true });

  server.addHook("onRequest", (request, reply, done) => {
    const origin = request.headers.origin;
    const allowedOrigins = resolveAllowedOrigins();
    if (origin && allowedOrigins.has(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
    }
    reply.header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type");
    // Web 是 operator surface，开发期会跨端口访问 API；preflight 在 API 边界直接收口。
    if (request.method === "OPTIONS") {
      void reply.code(204).send();
      return;
    }
    done();
  });

  server.get("/health", async () => getHealthStatus());
  server.get<{ Querystring: { limit?: string } }>("/tasks", async (request, reply) => {
    const databasePath = process.env.COORDINATOR_DB_PATH;
    if (!databasePath) {
      return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
    }

    const limit = parsePositiveInt(request.query.limit, 50);
    const tasks = withDatabase(databasePath, (context) => listOperatorTasks(context, limit));
    return { tasks };
  });
  server.post<{ Body: CreateTaskBody }>(
    "/tasks",
    {
      schema: {
        body: {
          type: "object",
          required: ["projectId", "title"],
          additionalProperties: false,
          properties: {
            projectId: { type: "string", minLength: 1 },
            title: { type: "string", minLength: 1 },
            description: { type: "string" },
            autonomy: { type: "string", enum: ["conservative", "balanced", "aggressive"] }
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
        const task = withDatabase(databasePath, (context) => createManualTask(context, request.body));
        return { task };
      } catch (error) {
        if (error instanceof OperatorSurfaceError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    }
  );
  server.post<{
    Params: { taskId: string };
    Body: TaskControlBody;
  }>(
    "/tasks/:taskId/control",
    {
      schema: {
        body: {
          type: "object",
          required: ["action", "expectedStateVersion"],
          additionalProperties: false,
          properties: {
            action: { type: "string", enum: ["pause", "resume", "cancel", "retry"] },
            expectedStateVersion: { type: "integer", minimum: 0 },
            reason: { type: "string" },
            actor: { type: "string", minLength: 1 },
            retryDelayMs: { type: "integer", minimum: 0 }
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
          controlTaskRuntime(context, {
            taskId: request.params.taskId,
            action: request.body.action,
            expectedStateVersion: request.body.expectedStateVersion,
            reason: request.body.reason,
            actor: request.body.actor ?? "api",
            retryDelayMs: request.body.retryDelayMs
          })
        );
      } catch (error) {
        if (
          error instanceof OperatorSurfaceError ||
          error instanceof ActiveResourceConflictError ||
          error instanceof CasConflictError
        ) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    }
  );
  server.get<{ Params: { taskId: string } }>("/tasks/:taskId", async (request, reply) => {
    const databasePath = process.env.COORDINATOR_DB_PATH;
    if (!databasePath) {
      return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
    }

    try {
      return withDatabase(databasePath, (context) => getOperatorTaskDetail(context, request.params.taskId));
    } catch (error) {
      if (error instanceof OperatorSurfaceError) {
        return reply.code(404).send({ error: error.message });
      }
      throw error;
    }
  });
  server.get<{ Params: { taskId: string } }>("/tasks/:taskId/timeline", async (request, reply) => {
    const databasePath = process.env.COORDINATOR_DB_PATH;
    if (!databasePath) {
      return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
    }

    const events = withDatabase(databasePath, (context) => listTaskEvents(context, request.params.taskId));
    return { taskId: request.params.taskId, events };
  });
  server.get<{ Params: { taskId: string } }>("/tasks/:taskId/summary", async (request, reply) => {
    const databasePath = process.env.COORDINATOR_DB_PATH;
    if (!databasePath) {
      return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
    }

    try {
      return withDatabase(databasePath, (context) => getOperatorExecutionSummary(context, request.params.taskId));
    } catch (error) {
      if (error instanceof OperatorSurfaceError) {
        return reply.code(404).send({ error: error.message });
      }
      throw error;
    }
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
    Params: { humanRequestId: string };
    Body: HumanAnswerBody;
  }>(
    "/human-requests/:humanRequestId/answer",
    {
      schema: {
        body: {
          type: "object",
          required: ["expectedStateVersion", "answer"],
          additionalProperties: false,
          properties: {
            expectedStateVersion: { type: "integer", minimum: 0 },
            answer: { type: "string", minLength: 1 },
            answeredBy: { type: "string", minLength: 1 }
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
          recordHumanAnswerRuntime(context, {
            humanRequestId: request.params.humanRequestId,
            expectedStateVersion: request.body.expectedStateVersion,
            answer: request.body.answer,
            answeredBy: request.body.answeredBy ?? "web-operator"
          })
        );
      } catch (error) {
        if (
          error instanceof OperatorSurfaceError ||
          error instanceof ActiveResourceConflictError ||
          error instanceof CasConflictError
        ) {
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
            profileId: request.body.profileId ?? undefined,
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

  server.post<{
    Body: DaemonTickBody;
  }>(
    "/daemon/tick",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            owner: { type: "string", minLength: 1 },
            retryBudget: { type: "integer", minimum: 0 },
            candidateLimit: { type: "integer", minimum: 1 }
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
          runDaemonTick(context, {
            owner: request.body.owner ?? "api",
            retryBudget: request.body.retryBudget,
            candidateLimit: request.body.candidateLimit
          })
        );
      } catch (error) {
        if (error instanceof DaemonRuntimeError || error instanceof ActiveResourceConflictError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    }
  );

  server.post<{ Params: { taskId: string }; Body: CreatePrBody }>(
    "/tasks/:taskId/pull-requests",
    {
      schema: {
        body: {
          type: "object",
          required: ["title", "bodyArtifact"],
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1 },
            bodyArtifact: { type: "string", minLength: 1 },
            actor: { type: "string", minLength: 1 }
          }
        }
      }
    },
    async (request, reply) => {
      const databasePath = process.env.COORDINATOR_DB_PATH;
      if (!databasePath) return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
      try {
        return withDatabase(databasePath, (context) =>
          createPullRequestRuntime(context, {
            taskId: request.params.taskId,
            title: request.body.title,
            bodyArtifact: request.body.bodyArtifact,
            actor: request.body.actor ?? "api"
          })
        );
      } catch (error) {
        if (error instanceof PullRequestProviderError || error instanceof ActiveResourceConflictError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    }
  );

  server.patch<{ Params: { taskId: string; prId: string }; Body: UpdatePrBody }>(
    "/tasks/:taskId/pull-requests/:prId",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1 },
            bodyArtifact: { type: "string", minLength: 1 },
            actor: { type: "string", minLength: 1 }
          }
        }
      }
    },
    async (request, reply) => {
      const databasePath = process.env.COORDINATOR_DB_PATH;
      if (!databasePath) return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
      try {
        return withDatabase(databasePath, (context) =>
          updatePullRequestRuntime(context, {
            taskId: request.params.taskId,
            prId: request.params.prId,
            title: request.body.title,
            bodyArtifact: request.body.bodyArtifact,
            actor: request.body.actor ?? "api"
          })
        );
      } catch (error) {
        if (error instanceof PullRequestProviderError || error instanceof ActiveResourceConflictError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    }
  );

  server.post<{ Params: { taskId: string; prId: string } }>(
    "/tasks/:taskId/pull-requests/:prId/inspect-review",
    async (request, reply) => {
      const databasePath = process.env.COORDINATOR_DB_PATH;
      if (!databasePath) return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
      try {
        return withDatabase(databasePath, (context) =>
          inspectPullRequestReviewRuntime(context, {
            taskId: request.params.taskId,
            prId: request.params.prId,
            actor: "api"
          })
        );
      } catch (error) {
        if (error instanceof PullRequestProviderError || error instanceof ActiveResourceConflictError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    }
  );

  server.post<{ Params: { taskId: string; prId: string }; Body: RequestMergeApprovalBody }>(
    "/tasks/:taskId/pull-requests/:prId/request-merge-approval",
    {
      schema: {
        body: {
          type: "object",
          required: ["artifact"],
          additionalProperties: false,
          properties: {
            artifact: { type: "string", minLength: 1 },
            actor: { type: "string", minLength: 1 }
          }
        }
      }
    },
    async (request, reply) => {
      const databasePath = process.env.COORDINATOR_DB_PATH;
      if (!databasePath) return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
      try {
        return withDatabase(databasePath, (context) =>
          requestMergeApprovalRuntime(context, {
            taskId: request.params.taskId,
            prId: request.params.prId,
            bodyArtifact: request.body.artifact,
            actor: request.body.actor ?? "api"
          })
        );
      } catch (error) {
        if (error instanceof PullRequestProviderError || error instanceof ActiveResourceConflictError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    }
  );

  server.post<{ Params: { taskId: string; prId: string }; Body: MergeApprovalBody }>(
    "/tasks/:taskId/pull-requests/:prId/merge-approval",
    {
      schema: {
        body: {
          type: "object",
          required: ["humanRequestId", "decision"],
          additionalProperties: false,
          properties: {
            humanRequestId: { type: "string", minLength: 1 },
            decision: { type: "string", enum: ["approve", "reject"] },
            actor: { type: "string", minLength: 1 }
          }
        }
      }
    },
    async (request, reply) => {
      const databasePath = process.env.COORDINATOR_DB_PATH;
      if (!databasePath) return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
      try {
        const fn = request.body.decision === "approve" ? approveMergeRuntime : rejectMergeRuntime;
        return withDatabase(databasePath, (context) =>
          fn(context, {
            taskId: request.params.taskId,
            prId: request.params.prId,
            humanRequestId: request.body.humanRequestId,
            actor: request.body.actor ?? "api",
            mergeStrategy: "squash"
          })
        );
      } catch (error) {
        if (error instanceof PullRequestProviderError || error instanceof ActiveResourceConflictError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    }
  );

  server.post<{ Params: { taskId: string; prId: string } }>(
    "/tasks/:taskId/pull-requests/:prId/merge",
    async (request, reply) => {
      const databasePath = process.env.COORDINATOR_DB_PATH;
      if (!databasePath) return reply.code(503).send({ error: "COORDINATOR_DB_PATH 未配置" });
      try {
        return withDatabase(databasePath, (context) =>
          mergeAfterApprovalRuntime(context, {
            taskId: request.params.taskId,
            prId: request.params.prId,
            actor: "api"
          })
        );
      } catch (error) {
        if (error instanceof PullRequestProviderError || error instanceof ActiveResourceConflictError) {
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

type CreateTaskBody = {
  projectId: string;
  title: string;
  description?: string;
  autonomy?: "conservative" | "balanced" | "aggressive";
};

type TaskControlBody = {
  action: "pause" | "resume" | "cancel" | "retry";
  expectedStateVersion: number;
  reason?: string;
  actor?: string;
  retryDelayMs?: number;
};

type CreateWorkspaceBody = {
  owner?: string;
};

type StartWorkflowBody = {
  profileId?: string;
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

type DaemonTickBody = {
  owner?: string;
  retryBudget?: number;
  candidateLimit?: number;
};

type CreatePrBody = {
  title: string;
  bodyArtifact: string;
  actor?: string;
};

type UpdatePrBody = {
  title?: string;
  bodyArtifact?: string;
  actor?: string;
};

type RequestMergeApprovalBody = {
  artifact: string;
  actor?: string;
};

type MergeApprovalBody = {
  humanRequestId: string;
  decision: "approve" | "reject";
  actor?: string;
};

type HumanAnswerBody = {
  expectedStateVersion: number;
  answer: string;
  answeredBy?: string;
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveAllowedOrigins(): Set<string> {
  const configured = process.env.COORDINATOR_WEB_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return new Set(
    configured && configured.length > 0
      ? configured
      : ["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:4173", "http://localhost:4173"]
  );
}
