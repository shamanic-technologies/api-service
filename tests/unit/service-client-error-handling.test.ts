import { describe, it, expect, vi, beforeEach } from "vitest";
import { callExternalService } from "../../src/lib/service-client.js";

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
