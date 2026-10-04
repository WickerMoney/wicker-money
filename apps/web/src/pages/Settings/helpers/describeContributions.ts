import type { RegisteredPlugin } from '../../../models/index.js'

/**
 * Says in a line what a plugin adds to the app, so an owner can tell what
 * switching it off takes away.
 *
 * @param contributes - The plugin's contribution summary.
 * @returns For example `Budgets page · Budget breakdown widget · server API`,
 * or `null` when it adds nothing visible.
 */
export function describeContributions(contributes: RegisteredPlugin['contributes']): string | null {
  const parts = [
    ...contributes.pages.map((title) => `${title} page`),
    ...contributes.widgets.map((title) => `${title} widget`),
    ...(contributes.endpoints ? ['server API'] : []),
  ]
  return parts.length === 0 ? null : parts.join(' · ')
}
