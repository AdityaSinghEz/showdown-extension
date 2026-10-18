import { BattleTracker } from '../lib/battle/state';
import { decisionTable } from '../lib/battle/summary';
import { isBridgeMessage } from '../lib/messaging';

/**
 * Isolated-world content script.
 *
 * Receives raw server messages from the MAIN-world hook, maintains battle
 * state, and reports each battle's outcome when it ends. Later phases attach
 * the rating panel and performance analysis to the same tracker.
 */
export default defineContentScript({
  matches: ['https://play.pokemonshowdown.com/*'],
  runAt: 'document_start',

  main() {
    const tracker = new BattleTracker();
    console.info('[ps-review] listener ready (v0.2.0, turn recording on)');

    tracker.onBattleEnd((state) => {
      console.info('[ps-review] battle ended', state);
      console.info(`[ps-review] decisions (${state.turns.length - 1} turns)`);
      console.table(decisionTable(state));
    });

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (!isBridgeMessage(event.data)) return;
      tracker.ingest(event.data.data);
    });
  },
});
