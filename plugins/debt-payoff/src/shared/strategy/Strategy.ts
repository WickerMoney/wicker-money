/**
 * How the money above the minimums is aimed.
 *
 * - `snowball`: the smallest balance first. Each payoff arrives sooner, which
 *   some people find easier to stick with.
 * - `avalanche`: the highest rate first. Costs the least interest.
 * - `custom`: the person's own order. Extra money goes to the debts in the
 *   order the caller lists them, skipping any that are already cleared.
 */
export type Strategy = 'snowball' | 'avalanche' | 'custom'
