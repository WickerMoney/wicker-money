import { DEBT_PAYOFF_PLUGIN_ID } from '../../server/constants.js'

/**
 * The host route of the plugin's page, for `ctx.navigate`.
 *
 * Plugin pages mount at `/p/<plugin id>/<page path>`; `debt-payoff` is the
 * page path the manifest declares.
 */
export const DEBT_PAYOFF_PAGE_PATH = `/p/${DEBT_PAYOFF_PLUGIN_ID}/debt-payoff`
