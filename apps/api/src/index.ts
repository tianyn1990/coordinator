import { buildServer } from "./server.js";

const port = Number.parseInt(process.env.COORDINATOR_API_PORT ?? "4310", 10);
const host = process.env.COORDINATOR_API_HOST ?? "127.0.0.1";

const server = buildServer();

try {
  await server.listen({ port, host });
} catch (error) {
  server.log.error(error);
  process.exitCode = 1;
}
