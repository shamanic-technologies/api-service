import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GATEWAY-500-ON-400-1028: a producer refusal must reach the caller under the
 * producer's status and body, even from a route whose catch rebuilds its own
 * `{ error: err.message }` envelope. Seen in prod 2026-10-27:
 * `GET /v1/campaigns?status=all` answered
 * `500 {"error":"{\"error\":\"status must be ...\"}"}` for campaign-service's 400.
 * Drives the REAL campaigns router (hard-coded 500 catch) with a stubbed fetch.
 */
vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>("../../src/middleware/auth.js");
  const fake = (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.runId = "run_test789";
    req.authType = "admin";
    next();
  };
  return { ...actual, authenticate: fake, requireOrg: (_q: any, _s: any, n: any) => n(), requireUser: (_q: any, _s: any, n: any) => n() };
});

import campaignsRouter from "../../src/routes/campaigns.js";
import { upstreamRefusal } from "../../src/middleware/upstream-refusal.js";

function buildApp(extra?: (app: express.Express) => void) {
  const app = express();
  app.use(express.json());
  app.use(upstreamRefusal);
  extra?.(app);
  app.use("/v1", campaignsRouter);
  return app;
}

function upstream(status: number, body: string) {
  (global.fetch as any) = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
    headers: new Headers({ "content-type": "application/json" }),
  });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("a producer refusal behind a route that hard-codes 500", () => {
  it("answers the producer's 400 with its body field-for-field (the prod case)", async () => {
    const producerBody = { error: 'status must be "ongoing" (running) or "stopped"', code: "invalid_status" };
    upstream(400, JSON.stringify(producerBody));

    const res = await request(buildApp()).get("/v1/campaigns?brandId=b1&status=all");

    expect(res.status).toBe(400);
    expect(res.body).toEqual(producerBody);
  });

  it("keeps a non-JSON producer body wrapped as { error } under the producer status", async () => {
    upstream(404, "Not Found");

    const res = await request(buildApp()).get("/v1/campaigns?brandId=b1");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not Found" });
  });

  it("un-flattens a producer 500 too, keeping its 500", async () => {
    upstream(500, JSON.stringify({ error: "db down", code: "db_unavailable" }));

    const res = await request(buildApp()).get("/v1/campaigns?brandId=b1");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "db down", code: "db_unavailable" });
  });
});

describe("what it never touches", () => {
  it("leaves a route's own error envelope alone when it does not echo the producer", async () => {
    upstream(400, JSON.stringify({ error: "bad" }));
    const app = buildApp((a) => {
      a.get("/own", async (_req, res) => {
        try {
          await (await import("../../src/lib/service-client.js")).callExternalService(
            (await import("../../src/lib/service-client.js")).externalServices.campaign,
            "/campaigns",
          );
        } catch {
          res.status(500).json({ error: "Failed to list campaigns" });
        }
      });
    });

    const res = await request(app).get("/own");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to list campaigns" });
  });

  it("leaves a success alone", async () => {
    upstream(200, JSON.stringify({ campaigns: [] }));

    const res = await request(buildApp()).get("/v1/campaigns?brandId=b1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ campaigns: [] });
  });
});
