import type { Strategy } from '../../shared/index.js'

/** What each strategy is called and what it does, in the words the page uses. */
export const STRATEGY_INFO: Readonly<Record<Strategy, { readonly label: string; readonly summary: string }>> = {
  snowball: {
    label: 'Snowball',
    summary: 'Extra money goes to the smallest balance first, so debts disappear sooner. It usually costs a little more interest.',
  },
  avalanche: {
    label: 'Avalanche',
    summary: 'Extra money goes to the highest rate first, which costs the least interest.',
  },
}
