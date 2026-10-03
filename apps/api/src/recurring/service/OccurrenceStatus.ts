/** All occurrence statuses, for schemas and tests. */
export const OCCURRENCE_STATUSES = ['upcoming', 'due', 'late', 'missed', 'cleared', 'skipped', 'assumed'] as const

/**
 * Where one occurrence stands.
 *
 * - `cleared`: every leg has a transaction settling it. Its money is in the
 *   balance already, wherever its date falls.
 * - `skipped`: the user said it will not happen.
 * - `upcoming`: expected after today. Legs already settled are not projected.
 * - `due`: expected today and not (fully) settled, on an item that is matched.
 *   Projected from tomorrow, since today's balance does not have it.
 * - `late`: like `due`, expected up to `LATE_DAYS` ago. Still projected.
 * - `missed`: like `late`, but older. No longer projected.
 * - `assumed`: on or before today on an item that has never been matched,
 *   or from before its first match. Assumed to have posted, which is what every projection did before
 *   matching existed, so someone who never matches sees no change.
 */
export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number]
