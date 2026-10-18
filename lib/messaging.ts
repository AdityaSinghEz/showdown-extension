/**
 * Cross-world messaging contract.
 *
 * The extension runs code in two JavaScript worlds on the same page:
 *
 * - the MAIN world, which shares globals with the Showdown client and can
 *   therefore observe its network traffic, and
 * - the ISOLATED world, which hosts the extension's own logic.
 *
 * The worlds cannot share objects, so they exchange plain, structured-clone
 * safe messages via `window.postMessage`. This module defines that contract.
 */

/** Identifies messages that originate from this extension. */
export const BRIDGE_SOURCE = 'ps-review' as const;

/** A raw server message forwarded from the MAIN world. */
export interface RawServerMessage {
  source: typeof BRIDGE_SOURCE;
  type: 'raw';
  /** The unmodified payload received by the Showdown client. */
  data: string;
}

/** All message shapes that may cross the world boundary. */
export type BridgeMessage = RawServerMessage;

/**
 * Narrows an arbitrary `postMessage` payload to a {@link BridgeMessage}.
 *
 * Any script on the page can post messages, so payloads must be validated
 * before use.
 *
 * @param value - The `MessageEvent.data` value to inspect.
 */
export function isBridgeMessage(value: unknown): value is BridgeMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<BridgeMessage>;
  return (
    candidate.source === BRIDGE_SOURCE &&
    candidate.type === 'raw' &&
    typeof candidate.data === 'string'
  );
}
