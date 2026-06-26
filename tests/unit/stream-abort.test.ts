import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// streamExternalService must abort the upstream fetch when the client socket
// closes, otherwise an orphaned reader keeps draining the upstream SSE for its
// full lifetime and leaks native undici buffers until the container OOMs.
const clientPath = path.join(__dirname, "../../src/lib/service-client.ts");
const src = fs.readFileSync(clientPath, "utf-8");

// Narrow to the streamExternalService function body so assertions can't be
// satisfied by unrelated code elsewhere in the file.
const streamFn = src.slice(src.indexOf("export async function streamExternalService"));

describe("streamExternalService — client-disconnect abort (OOM fix)", () => {
  it("creates an AbortController", () => {
    expect(streamFn).toContain("new AbortController()");
  });

  it("passes the abort signal to fetch init", () => {
    expect(streamFn).toContain("signal: controller.signal");
  });

  it("aborts the upstream fetch when the client socket closes", () => {
    expect(streamFn).toContain('expressRes.on("close"');
    expect(streamFn).toContain("controller.abort()");
  });

  it("does not log an abort-driven teardown as a real error", () => {
    expect(streamFn).toContain("controller.signal.aborted");
  });
});
