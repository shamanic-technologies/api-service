import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// Own file, deliberately WITHOUT the auth mock the behaviour test uses: this exercises
// the real `authenticate` / `requireOrg` / `requireStaff` chain, so "a non-staff caller is
// refused" is a real assertion about the shipped gate and not a property of a stub.
vi.hoisted(() => {
  process.env.TRANSACTIONAL_EMAIL_SERVICE_URL = "http://transactional-email.test.local";
  process.env.TRANSACTIONAL_EMAIL_SERVICE_API_KEY = "te-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
});

import mailingListsRouter from "../../src/routes/mailing-lists.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", mailingListsRouter);
  return app;
}

const ROUTES: Array<[string, string]> = [
  ["get", "/v1/mailing-lists/investors/subscribers"],
  ["post", "/v1/mailing-lists/investors/subscribers"],
  ["delete", "/v1/mailing-lists/investors/subscribers?email=a@b.com"],
  ["post", "/v1/mailing-lists/investors/updates"],
  ["get", "/v1/mailing-lists/investors/updates"],
];

describe("/v1/mailing-lists — auth gate", () => {
  beforeEach(() => {
    // Any outbound call from here means the request got past the gate, which is the
    // failure this file exists to catch.
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthorized request");
    });
  });

  it.each(ROUTES)("refuses %s %s with no credentials", async (method, path) => {
    const res = await (request(buildApp()) as any)[method](path);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing authentication");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(ROUTES)("refuses %s %s with a wrong platform key", async (method, path) => {
    const res = await (request(buildApp()) as any)[method](path).set(
      "X-API-Key",
      "not-the-admin-key",
    );
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(ROUTES)(
    "refuses %s %s from an admin-keyed caller with no resolvable identity",
    async (method, path) => {
      // The platform key is shared with the dashboard's server-side proxy, so it is not
      // an identity: without resolvable identity headers the request never gets an org.
      const res = await (request(buildApp()) as any)[method](path)
        .set("X-API-Key", "admin-test-key")
        .set("x-org-id", "someone-elses-org");
      expect(res.status).toBe(400);
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(ROUTES)(
    "refuses %s %s for an authenticated NON-STAFF caller (403, never reaches downstream)",
    async (method, path) => {
      // Identity resolves (so authenticate + requireOrg pass) but the email is not on the
      // staff allowlist — this is the customer-cannot-reach-it acceptance criterion.
      vi.resetModules();
      vi.doMock("../../src/middleware/auth.js", async () => {
        const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>(
          "../../src/middleware/auth.js",
        );
        return {
          ...actual,
          authenticate: (req: any, _res: any, next: any) => {
            req.userId = "user_customer";
            req.orgId = "org_customer";
            req.authType = "admin";
            req.headers["x-email"] = "customer@somebrand.com";
            next();
          },
        };
      });
      const { default: router } = await import("../../src/routes/mailing-lists.js");
      const app = express();
      app.use(express.json());
      app.use("/v1", router);

      const res = await (request(app) as any)[method](path);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Staff access required");
      expect(global.fetch).not.toHaveBeenCalled();

      vi.doUnmock("../../src/middleware/auth.js");
      vi.resetModules();
    },
  );

  it.each(ROUTES)(
    "refuses %s %s for a customer Bearer key even with a staff email forged on the wire",
    async (method, path) => {
      // authType "user_key" fails requireStaff condition 1, so a customer cannot forge
      // x-email on a direct call and self-authorize.
      vi.resetModules();
      vi.doMock("../../src/middleware/auth.js", async () => {
        const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>(
          "../../src/middleware/auth.js",
        );
        return {
          ...actual,
          authenticate: (req: any, _res: any, next: any) => {
            req.userId = "user_customer";
            req.orgId = "org_customer";
            req.authType = "user_key";
            next();
          },
        };
      });
      const { default: router } = await import("../../src/routes/mailing-lists.js");
      const app = express();
      app.use(express.json());
      app.use("/v1", router);

      const res = await (request(app) as any)[method](path).set(
        "x-email",
        "kevin.lourd@gmail.com",
      );
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Staff access required");
      expect(global.fetch).not.toHaveBeenCalled();

      vi.doUnmock("../../src/middleware/auth.js");
      vi.resetModules();
    },
  );
});
