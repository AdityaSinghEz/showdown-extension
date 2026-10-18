import { describe, expect, it, vi } from 'vitest';
import { findHost, waitForHost, wrapReceive, type ReceivingHost } from '../lib/hook';
import { isBridgeMessage } from '../lib/messaging';

function makeHost(): { host: ReceivingHost; received: string[] } {
  const received: string[] = [];
  const host: ReceivingHost = {
    receive(message: string) {
      received.push(message);
      return 'handled';
    },
  };
  return { host, received };
}

describe('wrapReceive', () => {
  it('notifies the observer and still calls the original', () => {
    const { host, received } = makeHost();
    const observer = vi.fn();
    wrapReceive(host, observer);

    const result = host.receive('hello');
    expect(observer).toHaveBeenCalledWith('hello');
    expect(received).toEqual(['hello']);
    expect(result).toBe('handled');
  });

  it('is idempotent per host', () => {
    const { host } = makeHost();
    const observer = vi.fn();
    expect(wrapReceive(host, observer)).toBe(true);
    expect(wrapReceive(host, observer)).toBe(false);
    host.receive('x');
    expect(observer).toHaveBeenCalledTimes(1);
  });

  it('does not break the client when the observer throws', () => {
    const { host, received } = makeHost();
    wrapReceive(host, () => {
      throw new Error('boom');
    });
    expect(() => host.receive('safe')).not.toThrow();
    expect(received).toEqual(['safe']);
  });
});

describe('findHost / waitForHost', () => {
  it('finds the legacy and rewrite globals', () => {
    const { host } = makeHost();
    expect(findHost({ app: host })?.name).toBe('app');
    expect(findHost({ PS: host })?.name).toBe('PS');
    expect(findHost({})).toBeNull();
  });

  it('resolves once the host appears', async () => {
    const scope: Record<string, unknown> = {};
    const pending = waitForHost(scope, { intervalMs: 5, timeoutMs: 1000 });
    setTimeout(() => {
      scope.app = makeHost().host;
    }, 20);
    expect((await pending)?.name).toBe('app');
  });

  it('resolves null after the timeout', async () => {
    expect(await waitForHost({}, { intervalMs: 5, timeoutMs: 30 })).toBeNull();
  });
});

describe('isBridgeMessage', () => {
  it('accepts well-formed messages only', () => {
    expect(isBridgeMessage({ source: 'ps-review', type: 'raw', data: 'x' })).toBe(true);
    expect(isBridgeMessage({ source: 'other', type: 'raw', data: 'x' })).toBe(false);
    expect(isBridgeMessage({ source: 'ps-review', type: 'raw', data: 1 })).toBe(false);
    expect(isBridgeMessage(null)).toBe(false);
    expect(isBridgeMessage('ps-review')).toBe(false);
  });
});
