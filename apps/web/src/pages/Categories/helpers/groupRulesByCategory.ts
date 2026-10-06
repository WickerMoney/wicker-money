import { orderByParent } from '@wickermoney/ui-kit'
import type { Category, Rule } from '../../../models/index.js'

/** The rules that assign one category. */
export interface RuleGroup {
  /** The category's id; also the group's stable key. */
  readonly categoryId: string
  /** The category's name, or a placeholder when it is no longer in the list. */
  readonly name: string
  /** The group's rules, in the order they came in (resolution order). */
  readonly rules: readonly Rule[]
}

/**
 * Splits rules into one group per category, in the order the categories are
 * listed on the page (each parent, then its children).
 *
 * Categories with no rules get no group. A rule whose category is missing from
 * `categories` still appears, under the placeholder name, rather than being
 * silently dropped. While `categories` is still loading, groups follow the
 * order the rules first mention them.
 *
 * @param rules - The saved rules.
 * @param categories - Every category, or `null` until loaded.
 * @returns The non-empty groups.
 */
export function groupRulesByCategory(
  rules: readonly Rule[],
  categories: readonly Category[] | null,
): RuleGroup[] {
  const byCategory = new Map<string, Rule[]>()
  for (const rule of rules) {
    const list = byCategory.get(rule.category_id) ?? []
    list.push(rule)
    byCategory.set(rule.category_id, list)
  }

  const known = orderByParent(categories ?? [])
  const knownIds = new Set(known.map((c) => c.id))
  const groups: RuleGroup[] = []
  for (const c of known) {
    const list = byCategory.get(c.id)
    if (list !== undefined) groups.push({ categoryId: c.id, name: c.name, rules: list })
  }
  for (const [categoryId, list] of byCategory) {
    if (!knownIds.has(categoryId)) groups.push({ categoryId, name: 'Unknown category', rules: list })
  }
  return groups
}
