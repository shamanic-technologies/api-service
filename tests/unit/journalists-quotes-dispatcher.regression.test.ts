import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "undici";

/**
 * Regression test: journalists-quotes-service /orgs/opportunities/ranked runs
 * heavy RAG ranking that legitimately takes 5–10 minutes on large brand-sets.
 *
 * `externalServices.journalistsQuotes` MUST carry a `dispatcher` (undici Agent
 * with bumped headers + body timeouts) and `callExternalServiceWithStatus`
 * MUST forward it to `fetch()`, otherwise prod fails with
 * `UND_ERR_HEADERS_TIMEOUT` after Node's default 300s.
 *
 * Other services MUST NOT have a dispatcher (opt-in only) so default behavior
 * is preserved everywhere else.
 */

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  process.env.JOURNALISTS_QUOTES_SERVICE_URL = "http://jq.test";
  process.env.JOURNALISTS_QUOTES_SERVICE_API_KEY = "test-key";
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("journalists-quotes dispatcher", () => {
  it("externalServices.journalistsQuotes.dispatcher is an undici Agent", async () => {
    const { externalServices } = await import("../../src/lib/service-client.js");
    expect(externalServices.journalistsQuotes.dispatcher).toBeDefined();
    expect(externalServices.journalistsQuotes.dispatcher).toBeInstanceOf(Agent);
  });

  it("other service entries do NOT carry a dispatcher (opt-in only)", async () => {
    const { externalServices } = await import("../../src/lib/service-client.js");
    expect((externalServices.brand as { dispatcher?: unknown }).dispatcher).toBeUndefined();
    expect((externalServices.runs as { dispatcher?: unknown }).dispatcher).toBeUndefined();
    expect((externalServices.billing as { dispatcher?: unknown }).dispatcher).toBeUndefined();
    expect((externalServices.client as { dispatcher?: unknown }).dispatcher).toBeUndefined();
  });

  it("callExternalServiceWithStatus forwards service.dispatcher to fetch", async () => {
    const { callExternalServiceWithStatus, externalServices } = await import(
      "../../src/lib/service-client.js"
    );
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await callExternalServiceWithStatus(
      externalServices.journalistsQuotes,
      "/orgs/opportunities/ranked",
      { method: "POST", body: { brandIds: ["b1"] } }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as { dispatcher?: unknown };
    expect(init.dispatcher).toBe(externalServices.journalistsQuotes.dispatcher);
  });

  it("callExternalServiceWithStatus omits dispatcher when service lacks one", async () => {
    const { callExternalServiceWithStatus } = await import("../../src/lib/service-client.js");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await callExternalServiceWithStatus(
      { url: "http://no-dispatcher.test", apiKey: "k" },
      "/foo"
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as { dispatcher?: unknown };
    expect(init.dispatcher).toBeUndefined();
  });
});
