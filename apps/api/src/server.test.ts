import { describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

describe("API health", () => {
  it("返回 coordinator 健康状态", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      service: "coordinator"
    });
  });
});
