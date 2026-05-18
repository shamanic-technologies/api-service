import { describe, it, expect, vi, beforeEach } from "vitest";
import { callExternalService, streamExternalService } from "../../src/lib/service-client.js";

const service = { url: "http://localhost:9999", apiKey: "test-key" };

describe("callExternalService error handling", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("propagates upstream JSON error body verbatim in Error.message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve(JSON.stringify({ error: "chat-service unreachable" })),
      }),
    );

    await expect(callExternalService(service, "/complete")).rejects.toThrow(
      "chat-service unreachable",
    );
  });

  it("propagates plain-text upstream body in Error.message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: () => Promise.resolve("upstream gateway timeout"),
      }),
    );

    await expect(callExternalService(service, "/health")).rejects.toThrow(
      "upstream gateway timeout",
    );
  });

  it("falls back to `Service call failed: <status>` when upstream body is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve(""),
      }),
    );

    await expect(callExternalService(service, "/x")).rejects.toThrow(
      "Service call failed: 500",
    );
  });

  it("preserves statusCode on thrown Error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: () => Promise.resolve(JSON.stringify({ error: "invalid input" })),
      }),
    );

    try {
      await callExternalService(service, "/x");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as Error & { statusCode: number }).statusCode).toBe(422);
      expect((err as Error).message).toContain("invalid input");
    }
  });

  it("logs full upstream body server-side via console.error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const upstreamBody = JSON.stringify({ error: "boom", stack: "lots of detail here" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve(upstreamBody),
      }),
    );

    await expect(callExternalService(service, "/x")).rejects.toThrow("boom");

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("upstream error 500"),
      upstreamBody,
    );
  });

  it("logs fetch cause when fetch itself fails (e.g. DNS/network)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const networkError = new TypeError("fetch failed");
    (networkError as any).cause = { code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND badhost" };

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError));

    await expect(callExternalService(service, "/resolve", { method: "POST" })).rejects.toThrow("fetch failed");

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("(cause: ENOTFOUND)"),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("http://localhost:9999/resolve"),
    );
  });
});

describe("streamExternalService error logging", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should log upstream errors with console.warn when response is not ok", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorBody = JSON.stringify({ error: "Insufficient credits", balance_cents: 200, required_cents: 500 });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 402,
        text: () => Promise.resolve(errorBody),
      }),
    );

    const expressRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;

    await streamExternalService(service, "/chat", {
      method: "POST",
      body: { message: "hello" },
      headers: { "x-org-id": "test-org" },
      expressRes,
    });

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("POST /chat upstream error: 402"),
      expect.stringContaining("Insufficient credits"),
    );
    expect(expressRes.status).toHaveBeenCalledWith(402);
    expect(expressRes.json).toHaveBeenCalledWith({ error: errorBody });
  });
});
