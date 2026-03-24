import { describe, it, expect, vi, beforeEach } from "vitest";
import { callExternalService, streamExternalService } from "../../src/lib/service-client.js";

const service = { url: "http://localhost:9999", apiKey: "test-key" };

describe("callExternalService error handling", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should extract error message from JSON error response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve(JSON.stringify({ error: "Invalid API key format" })),
      }),
    );

    await expect(callExternalService(service, "/validate")).rejects.toThrow(
      "Invalid API key format",
    );
    // Must NOT contain the raw JSON wrapper
    await expect(callExternalService(service, "/validate")).rejects.not.toThrow(
      "Service call failed: 401",
    );
  });

  it("should fall back to raw text when response is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      }),
    );

    await expect(callExternalService(service, "/health")).rejects.toThrow(
      "Service call failed: 500 - Internal Server Error",
    );
  });

  it("should log fetch cause when fetch itself fails (e.g. DNS/network)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const networkError = new TypeError("fetch failed");
    (networkError as any).cause = { code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND badhost" };

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError));

    await expect(callExternalService(service, "/resolve", { method: "POST" })).rejects.toThrow("fetch failed");

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("(cause: ENOTFOUND)"),
    );
    // Should log the full URL, not just the path
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("http://localhost:9999/resolve"),
    );
  });

  it("should use status code when JSON has no error field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve(JSON.stringify({ message: "Forbidden" })),
      }),
    );

    await expect(callExternalService(service, "/resource")).rejects.toThrow(
      "Service call failed: 403",
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
