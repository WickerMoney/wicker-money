/**
 * How the money above the minimums is aimed.
 *
 * - `snowball`: the smallest balance first. Each payoff arrives sooner, which
 *   some people find easier to stick with.
 * - `avalanche`: the highest rate first. Costs the least interest.
 */
export type Strategy = 'snowball' | 'avalanche'
