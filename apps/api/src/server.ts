import Fastify, { type FastifyInstance } from "fastify";
import { getHealthStatus } from "@coordinator/shared";

export function buildServer(): FastifyInstance {
  const server = Fastify({ logger: true });

  server.get("/health", async () => getHealthStatus());

  return server;
}
