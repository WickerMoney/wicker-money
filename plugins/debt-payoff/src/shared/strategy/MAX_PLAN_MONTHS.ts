/**
 * The longest schedule the engine will build: 600 months, fifty years.
 *
 * A 30-year mortgage is 360 months, so every debt that can be paid off by
 * paying its minimum fits with room to spare. A plan that is still owing after
 * this is reported as `capped` with no debt-free date instead of being
 * extended. The limit also bounds the work and the size of the response: with
 * a minimum below the monthly interest the balance only grows, and without a
 * limit the loop would never end.
 */
export const MAX_PLAN_MONTHS = 600
