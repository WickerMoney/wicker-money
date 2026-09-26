/** The plugin's identifier, which also forms its API base path. */
export const BUDGETS_PLUGIN_ID = 'wickermoney.budgets'

/**
 * This plugin's endpoints, relative to the host's API root.
 *
 * Deliberately without the `/api/v1` prefix. The host mounts plugin routes under
 * its own versioned base and clients add the same base themselves, so a path
 * that also spells the version would become `/api/v1/api/v1/p/...` and return a
 * 404 that looks like the route was never registered.
 */
export const BUDGETS_API_BASE = `/p/${BUDGETS_PLUGIN_ID}`

/**
 * How far back carry-forward is reconstructed.
 *
 * Every rollover month depends on the one before it, so an exact answer means
 * replaying a category's whole history. Twenty-four months is the compromise:
 * long enough that no real sinking fund is truncated, short enough that a
 * ten-year-old ledger does not make opening the page a full table scan. The
 * chain also breaks at any month with no line, which in practice cuts it far
 * shorter than this.
 */
export const CARRY_LOOKBACK_MONTHS = 24
