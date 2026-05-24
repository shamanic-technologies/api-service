import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getRunsBatch, type RunWithCosts } from "../../src/index";

const RUNS_SERVICE_URL = process.env.RUNS_SERVICE_URL || "https://runs.distribute.you";

function makeRun(id: string): RunWithCosts {
  return {
    id,
    parentRunId: null,
    organizationId: "org-1",
    userId: null,
    brandId: null,
    campaignId: null,
    serviceName: "svc",
    taskName: "task",
    status: "completed",
    startedAt: "2026-01-01T00:00:00Z",
    completedAt: "2026-01-01T00:00:01Z",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:01Z",
    costs: [],
    ownCostInUsdCents: "0",
    childrenCostInUsdCents: "0",
    totalCostInUsdCents: "0",
    descendantRuns: [],
  };
}

describe("getRunsBatch", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("N=0: makes no HTTP call and returns empty Map", async () => {
    const result = await getRunsBatch([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it("N<=10000: makes one POST /v1/runs/batch with runIds body, includes x-org-id and X-API-Key", async () => {
    const ids = ["a", "b", "c", "d", "e"];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ runs: ids.map(makeRun) }),
    });

    const result = await getRunsBatch(ids, "org-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${RUNS_SERVICE_URL}/v1/runs/batch`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ runIds: ids });
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers["X-API-Key"]).toBeDefined();
    expect(init.headers["x-org-id"]).toBe("org-1");

    expect(result.size).toBe(5);
    expect(result.get("a")?.id).toBe("a");
    expect(result.get("e")?.id).toBe("e");
  });

  it("N>10000: chunks into multiple parallel POSTs of <=10000, merges results", async () => {
    const ids = Array.from({ length: 10001 }, (_, i) => `id-${i}`);

    fetchMock.mockImplementation(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { runIds: string[] };
      return {
        ok: true,
        json: async () => ({ runs: body.runIds.map(makeRun) }),
      };
    });

    const result = await getRunsBatch(ids, "org-1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const chunks = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).runIds.length);
    expect(chunks.sort((a, b) => b - a)).toEqual([10000, 1]);
    expect(result.size).toBe(10001);
  });

  it("response with fewer runs than requested (out-of-org silently omitted): Map size matches response, not request", async () => {
    const ids = ["a", "b", "c"];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ runs: [makeRun("a"), makeRun("c")] }),
    });

    const result = await getRunsBatch(ids, "org-1");

    expect(result.size).toBe(2);
    expect(result.has("a")).toBe(true);
    expect(result.has("b")).toBe(false);
    expect(result.has("c")).toBe(true);
  });

  it("merges caller-provided headers with identity + auth headers", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ runs: [] }),
    });

    await getRunsBatch(["a"], "org-1", { "x-user-id": "user-1", "x-trace-id": "trace-1" });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["x-org-id"]).toBe("org-1");
    expect(init.headers["x-user-id"]).toBe("user-1");
    expect(init.headers["x-trace-id"]).toBe("trace-1");
    expect(init.headers["X-API-Key"]).toBeDefined();
  });

  it("throws on non-2xx upstream response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "internal server error",
    });

    await expect(getRunsBatch(["a"], "org-1")).rejects.toThrow(/runs-service POST \/v1\/runs\/batch failed: 500/);
  });
});
