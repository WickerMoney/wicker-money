/** The plugin's identifier, which also forms its API base path. */
export const DEBT_PAYOFF_PLUGIN_ID = 'wickermoney.debt-payoff'

/**
 * This plugin's endpoints, relative to the host's API root.
 *
 * Deliberately without the `/api/v1` prefix: the host mounts plugin routes
 * under its own versioned base and clients add the same base themselves.
 */
export const DEBT_PAYOFF_API_BASE = `/p/${DEBT_PAYOFF_PLUGIN_ID}`

/**
 * The most debts a person can have that are not archived.
 *
 * The plan is built on every request and its size grows with the number of
 * debts times the months to pay them off, so the number of debts is bounded
 * where they are written rather than discovered when a plan is slow. Fifty is
 * more than any household has (the longest lists people keep are around a
 * dozen); archive paid-off debts to make room.
 */
export const MAX_ACTIVE_DEBTS = 50
