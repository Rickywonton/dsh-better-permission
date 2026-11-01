/**
 * Host half of the browser-only bundle.
 *
 * The UI itself lives in ./client.js, which the Harness Web client loads from
 * the boot graph. A package is only scanned for a client bundle while its
 * Loader row is active, so this module exists to keep the row mounted — it has
 * no Host behaviour and no config.
 */
export const name = 'permission-tiers-ui'

export function apply() {}
