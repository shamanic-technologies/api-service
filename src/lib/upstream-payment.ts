import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request memory of "a downstream service answered 402 Payment Required".
 *
 * Many route catches here still rebuild their own envelope with a hard-coded
 * 500, so the downstream's 402 is gone by the time the response is written.
 * The service client records the upstream 402 here instead, and
 * `middleware/payment-required.ts` reads it when the response goes out: for an
 * org opened by an AI agent (no free credit, prepaid only) that response becomes
 * a legible 402 telling the agent how to prepay. Nothing else reads it.
 */
interface UpstreamPaymentState {
  /** Body of the last downstream 402 seen while serving this request, verbatim. */
  paymentRequiredBody?: string;
}

const storage = new AsyncLocalStorage<UpstreamPaymentState>();

/** Run the rest of the request inside its own state. */
export function runWithUpstreamPaymentState<T>(fn: () => T): T {
  return storage.run({}, fn);
}

/** Called by the service client on every non-2xx downstream answer. */
export function noteUpstreamStatus(status: number, body: string): void {
  if (status !== 402) return;
  const state = storage.getStore();
  if (state) state.paymentRequiredBody = body;
}

/** The downstream 402 body seen while serving this request, if any. */
export function upstreamPaymentRequiredBody(): string | undefined {
  return storage.getStore()?.paymentRequiredBody;
}
