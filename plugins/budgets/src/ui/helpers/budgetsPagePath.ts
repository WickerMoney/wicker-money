import { BUDGETS_PLUGIN_ID } from '../../server/constants.js'

/**
 * The host route of the plugin's Budgets page, for `ctx.navigate`.
 *
 * Plugin pages mount at `/p/<plugin id>/<page path>`; `budgets` is the page path
 * the manifest declares.
 */
export const BUDGETS_PAGE_PATH = `/p/${BUDGETS_PLUGIN_ID}/budgets`
