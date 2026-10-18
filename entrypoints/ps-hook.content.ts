import { waitForHost, wrapReceive } from '../lib/hook';
import { BRIDGE_SOURCE, type RawServerMessage } from '../lib/messaging';

/**
 * MAIN-world content script.
 *
 * Runs in the page's own JavaScript context so it can reach the Showdown
 * client's globals. Its only job is to forward every raw server message to the
 * isolated-world listener; all parsing and state live there.
 */
export default defineContentScript({
  matches: ['https://play.pokemonshowdown.com/*'],
  world: 'MAIN',
  runAt: 'document_start',

  async main() {
    const found = await waitForHost(window as unknown as Record<string, unknown>);
    if (!found) {
      console.warn('[ps-review] Showdown client not found; no battles will be tracked.');
      return;
    }

    wrapReceive(found.host, (data) => {
      const message: RawServerMessage = { source: BRIDGE_SOURCE, type: 'raw', data };
      window.postMessage(message, window.location.origin);
    });
    console.info(`[ps-review] hooked into Showdown client via window.${found.name}`);
  },
});
