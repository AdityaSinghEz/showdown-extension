import { defineConfig } from 'wxt';

/**
 * WXT build configuration.
 *
 * The extension requests no browser permissions: it only runs content scripts
 * on the Pokemon Showdown client origin and keeps all data in memory.
 */
export default defineConfig({
  manifest: {
    name: 'PS Review',
    description:
      'Rating context and performance review for Pokemon Showdown battles.',
    permissions: [],
  },
});
