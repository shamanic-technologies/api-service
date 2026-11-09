import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// No auth mock: the real authenticate / requireOrg gate runs.
vi.hoisted(() => {
  process.env.CHAT_SERVICE_URL = "http://chat.test.local";
  process.env.CHAT_SERVICE_API_KEY = "chat-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
});

import brandMcpRouter from "../../src/routes/brand-mcp-servers.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandMcpRouter);
  return app;
}

const BRAND = "f4d73dab-1f9d-49b2-b16e-63ecde76a5eb";
const SERVER = "11111111-1111-4111-8111-111111111111";

describe("brand MCP server routes (BRAND-MCP-1109): auth gate", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthenticated request");
    });
  });

  for (const [method, path] of [
    ["get", `/v1/brands/${BRAND}/mcp-servers`],
    ["post", `/v1/brands/${BRAND}/mcp-servers`],
    ["post", `/v1/brands/${BRAND}/mcp-servers/${SERVER}/check`],
    ["delete", `/v1/brands/${BRAND}/mcp-servers/${SERVER}`],
  ] as const) {
    it(`${method.toUpperCase()} ${path} refuses a call with no credentials`, async () => {
      const res = await request(buildApp())[method](path);
      expect(res.status).toBe(401);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it(`${method.toUpperCase()} ${path} refuses a wrong platform key`, async () => {
      const res = await request(buildApp())[method](path).set("X-API-Key", "nope");
      expect(res.status).toBe(401);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  }
});
