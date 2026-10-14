import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices (src/lib/service-client.ts) snapshots *_SERVICE_URL at module load,
// so the base must be set BEFORE the router imports. vi.hoisted runs before imports.
const { BRAND_BASE } = vi.hoisted(() => {
  const BRAND_BASE = "http://brand.test.local";
  process.env.BRAND_SERVICE_URL = BRAND_BASE;
  process.env.BRAND_SERVICE_API_KEY = "brand-test-key";
  return { BRAND_BASE };
});

/**
 * Offer documents (/v1/brands/:id/offers/:offerId/documents[/:documentId]): BEHAVIOURAL cover
 * over the real router with a stubbed fetch. Each route reaches brand-service's own path with
 * the authenticated identity; the upload keeps the upstream 201/200 and passes both encodings
 * through (a ~7 MB base64 JSON body, and a multipart body byte for byte with its boundary).
 */

vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>(
    "../../src/middleware/auth.js",
  );
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.userId = "user_test123";
      req.orgId = "org_test456";
      req.runId = "run_test789";
      req.authType = "user_key";
      next();
    },
  };
});

import brandRouter, { MAX_OFFER_DOCUMENT_MULTIPART_BYTES } from "../../src/routes/brand.js";

function buildApp() {
  const app = express();
  // Same limit as src/index.ts.
  app.use(express.json({ limit: "10mb" }));
  app.use("/v1", brandRouter);
  return app;
}

const BRAND_ID = "75d7e3e8-6926-4f85-a557-976895400666";
const OFFER_ID = "0d3d1f2c-8f4a-4a2e-9d1b-2f0f6a7c5b31";
const DOC_ID = "5b0e9a1c-3d2f-4e6a-8b7c-1a2b3c4d5e6f";
const BASE = `/v1/brands/${BRAND_ID}/offers/${OFFER_ID}/documents`;
const DOWNSTREAM = `${BRAND_BASE}/orgs/brands/${BRAND_ID}/offers/${OFFER_ID}/documents`;

describe("offer documents proxies", () => {
  let calls: Array<{ url: string; options: any }>;

  function stub(status: number, body: unknown) {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: status < 400,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      };
    });
  }

  beforeEach(() => {
    calls = [];
  });

  it("GET list reaches brand-service's own path with the identity, body byte-identical", async () => {
    const body = { documents: [{ id: DOC_ID, fileName: "a.pdf" }] };
    stub(200, body);
    const res = await request(buildApp()).get(BASE);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(body);
    expect(calls[0].url).toBe(DOWNSTREAM);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
  });

  for (const method of ["get", "patch", "delete"] as const) {
    it(`${method.toUpperCase()} one document reaches brand-service's own path`, async () => {
      const body = { document: { id: DOC_ID, description: "x" } };
      stub(200, body);
      const req = request(buildApp())[method](`${BASE}/${DOC_ID}`);
      const res = method === "patch" ? await req.send({ description: "New words", extra: 1 }) : await req;
      expect(res.status).toBe(200);
      expect(res.body).toEqual(body);
      expect(calls[0].url).toBe(`${DOWNSTREAM}/${DOC_ID}`);
      expect(calls[0].options.method).toBe(method.toUpperCase());
      expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
      if (method === "patch") {
        expect(JSON.parse(calls[0].options.body)).toEqual({ description: "New words", extra: 1 });
      } else {
        expect(calls[0].options.body).toBeUndefined();
      }
    });
  }

  it("JSON upload of a ~7 MB base64 body passes through untouched and keeps the 201", async () => {
    const contentBase64 = Buffer.alloc(5 * 1024 * 1024, 7).toString("base64");
    const upload = { fileName: "deck.pdf", description: "Our one-pager", contentBase64 };
    const body = { document: { id: DOC_ID }, created: true };
    stub(201, body);
    const res = await request(buildApp()).post(BASE).send(upload);
    expect(res.status).toBe(201);
    expect(res.body).toEqual(body);
    expect(calls[0].url).toBe(DOWNSTREAM);
    expect(calls[0].options.method).toBe("POST");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(JSON.parse(calls[0].options.body)).toEqual(upload);
  });

  it("keeps the 200 of an upload whose bytes were already on the offer", async () => {
    stub(200, { document: { id: DOC_ID }, created: false });
    const res = await request(buildApp())
      .post(BASE)
      .send({ fileName: "a.pdf", description: "d", contentBase64: "AAAA" });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
  });

  it("multipart upload is forwarded byte for byte with its boundary", async () => {
    const file = Buffer.from("%PDF-1.4 fake pdf bytes é");
    stub(201, { document: { id: DOC_ID }, created: true });
    const res = await request(buildApp())
      .post(BASE)
      .field("description", "Case study")
      .attach("file", file, { filename: "case.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(201);
    expect(calls[0].url).toBe(DOWNSTREAM);
    const ct: string = calls[0].options.headers["content-type"];
    expect(ct).toMatch(/^multipart\/form-data; boundary=/);
    const sent: Buffer = calls[0].options.body;
    expect(Buffer.isBuffer(sent)).toBe(true);
    expect(sent.includes(file)).toBe(true);
    expect(sent.toString("latin1")).toContain(ct.split("boundary=")[1]);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["X-API-Key"]).toBe("brand-test-key");
  });

  it("refuses a multipart body over the cap with 413 before calling brand-service", async () => {
    stub(201, {});
    const res = await request(buildApp())
      .post(BASE)
      .field("description", "Too big")
      .attach("file", Buffer.alloc(MAX_OFFER_DOCUMENT_MULTIPART_BYTES + 1, 1), "big.pdf");
    expect(res.status).toBe(413);
    expect(res.body.reason).toBe("payload_too_large");
    expect(calls).toHaveLength(0);
  });

  it("forwards brand-service's 413 file_too_large AS a 413 with its body", async () => {
    const refusal = { error: "The file is over 5 MB.", reason: "file_too_large" };
    stub(413, refusal);
    const res = await request(buildApp())
      .post(BASE)
      .send({ fileName: "a.pdf", description: "d", contentBase64: "AAAA" });
    expect(res.status).toBe(413);
    expect(res.body).toEqual(refusal);
  });
});
