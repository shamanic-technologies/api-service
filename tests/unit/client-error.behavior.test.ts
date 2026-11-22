import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";
import { readFileSync } from "node:fs";
import { clientErrorHandler } from "../../src/middleware/client-error.js";

/**
 * GATEWAY-PARSE-400-1122: three POST /v1/content/preview-email calls arrived
 * with a double-encoded JSON body (2026-11-22). body-parser raised a 400
 * `entity.parse.failed`, the fallback answered 500, and our writer told a
 * client the email writer was down. A client error must stay a 4xx that names
 * the bad request; a real fault stays 500.
 */

function buildApp(limit = "10mb") {
  const app = express();
  app.use(express.json({ limit }));
  app.post("/v1/content/preview-email", (req, res) => res.json({ ok: true, body: req.body }));
  app.get("/boom", () => {
    throw new Error("db exploded");
  });
  app.get("/teapot", () => {
    throw Object.assign(new Error("No coffee here"), { status: 418, expose: true });
  });
  app.use(clientErrorHandler);
  app.use((_err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: "Internal server error" });
  });
  return app;
}

describe("client errors raised before the route", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});

  it("answers a double-encoded JSON body with 400 invalid_json_body, not 500", async () => {
    const doubleEncoded = JSON.stringify(JSON.stringify({ brandId: "b1", subject: "Hi" }));
    const res = await request(buildApp())
      .post("/v1/content/preview-email")
      .set("Content-Type", "application/json")
      .send(doubleEncoded);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_json_body");
    expect(res.body.error).toMatch(/request body is not valid JSON/);
    expect(res.body.fix).toMatch(/JSON-encode it twice/);
  });

  it("answers a truncated JSON body with 400", async () => {
    const res = await request(buildApp())
      .post("/v1/content/preview-email")
      .set("Content-Type", "application/json")
      .send('{"brandId": "b1"');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_json_body");
  });

  it("answers a body over the limit with 413 body_too_large", async () => {
    const res = await request(buildApp("10b"))
      .post("/v1/content/preview-email")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ brandId: "a much longer body than ten bytes" }));
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("body_too_large");
  });

  it("keeps any other error carrying a 4xx as that 4xx with its message", async () => {
    const res = await request(buildApp()).get("/teapot");
    expect(res.status).toBe(418);
    expect(res.body).toEqual({ code: "bad_request", error: "No coffee here" });
  });

  it("keeps a real server fault at 500", async () => {
    const res = await request(buildApp()).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });

  it("still serves a valid body", async () => {
    const res = await request(buildApp()).post("/v1/content/preview-email").send({ brandId: "b1" });
    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ brandId: "b1" });
  });

  it("is mounted in the real app before the Sentry and 500 handlers", () => {
    const src = readFileSync(new URL("../../src/index.ts", import.meta.url), "utf8");
    const mount = src.indexOf("app.use(clientErrorHandler)");
    expect(mount).toBeGreaterThan(src.indexOf("express.json({ limit"));
    expect(mount).toBeLessThan(src.indexOf("Sentry.setupExpressErrorHandler(app)"));
    expect(mount).toBeLessThan(src.indexOf('"Internal server error"'));
  });
});
