/**
 * Hook for the Showdown client's inbound message handler.
 *
 * Showdown ships two client implementations that expose a global object with
 * a `receive(message)` method which every server message passes through:
 * the legacy client (`window.app`) and the Preact rewrite (`window.PS`).
 * This module wraps that method so the extension can observe messages without
 * altering the client's behaviour.
 */

/** Minimal shape of a Showdown client host object. */
export interface ReceivingHost {
  receive(message: string): unknown;
}

/** Callback invoked with each raw server message. */
export type MessageObserver = (message: string) => void;

/** Global names under which a Showdown client may expose its host object. */
export const HOST_GLOBAL_NAMES = ['app', 'PS'] as const;

const wrapped = new WeakSet<object>();

function isReceivingHost(value: unknown): value is ReceivingHost {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { receive?: unknown }).receive === 'function'
  );
}

/**
 * Locates the Showdown client host on a global object.
 *
 * @param scope - The global object to search, normally `window`.
 * @returns The host and the global name it was found under, or `null`.
 */
export function findHost(
  scope: Record<string, unknown>,
): { name: string; host: ReceivingHost } | null {
  for (const name of HOST_GLOBAL_NAMES) {
    const candidate = scope[name];
    if (isReceivingHost(candidate)) return { name, host: candidate };
  }
  return null;
}

/**
 * Wraps `host.receive` so that `observer` sees every message first.
 *
 * The original method is always invoked afterwards with the same arguments
 * and `this` binding, and observer errors are swallowed so a faulty observer
 * can never break the client. Wrapping is idempotent per host object.
 *
 * @param host - The Showdown client host object.
 * @param observer - Called with each raw message.
 * @returns `true` if the host was wrapped, `false` if already wrapped.
 */
export function wrapReceive(host: ReceivingHost, observer: MessageObserver): boolean {
  if (wrapped.has(host)) return false;
  wrapped.add(host);

  const original = host.receive;
  host.receive = function (this: unknown, message: string): unknown {
    try {
      observer(String(message));
    } catch {
      // Observation must never interfere with the client.
    }
    return original.call(this ?? host, message);
  };
  return true;
}

/** Options for {@link waitForHost}. */
export interface WaitOptions {
  /** Polling interval in milliseconds. Defaults to 250. */
  intervalMs?: number;
  /** Give up after this many milliseconds. Defaults to 60000. */
  timeoutMs?: number;
}

/**
 * Polls until a Showdown client host appears on `scope`, then resolves.
 *
 * @param scope - The global object to search, normally `window`.
 * @param options - Polling configuration.
 * @returns The located host, or `null` if the timeout elapses first.
 */
export function waitForHost(
  scope: Record<string, unknown>,
  options: WaitOptions = {},
): Promise<{ name: string; host: ReceivingHost } | null> {
  const { intervalMs = 250, timeoutMs = 60_000 } = options;
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve) => {
    const poll = (): void => {
      const found = findHost(scope);
      if (found) return resolve(found);
      if (Date.now() >= deadline) return resolve(null);
      setTimeout(poll, intervalMs);
    };
    poll();
  });
}
