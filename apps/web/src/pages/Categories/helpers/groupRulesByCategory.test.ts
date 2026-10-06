import { describe, expect, it } from 'vitest'
import type { Category, Rule } from '../../../models/index.js'
import { groupRulesByCategory } from './groupRulesByCategory.js'

const category = (id: string, name: string, parent_id: string | null = null): Category =>
  ({ id, name, parent_id, slug: id, is_enabled: true, kind: 'expense' }) as Category
const rule = (id: string, category_id: string): Rule =>
  ({ id, category_id, priority: 0, conditions: [] }) as unknown as Rule

describe('groupRulesByCategory', () => {
  const categories = [
    category('food', 'Food'),
    category('home', 'Housing'),
    category('groc', 'Groceries', 'food'),
  ]

  it('groups rules by category, in the order the categories are listed', () => {
    const groups = groupRulesByCategory(
      [rule('r1', 'groc'), rule('r2', 'home'), rule('r3', 'groc')],
      categories,
    )
    expect(groups.map((g) => [g.name, g.rules.map((r) => r.id)])).toEqual([
      ['Groceries', ['r1', 'r3']],
      ['Housing', ['r2']],
    ])
  })

  it('leaves out categories that have no rules', () => {
    expect(groupRulesByCategory([rule('r1', 'home')], categories).map((g) => g.categoryId)).toEqual(['home'])
  })

  it('keeps a rule whose category is missing, under a placeholder', () => {
    const groups = groupRulesByCategory([rule('r1', 'gone')], categories)
    expect(groups).toEqual([{ categoryId: 'gone', name: 'Unknown category', rules: [rule('r1', 'gone')] }])
  })

  it('still groups while the categories are loading', () => {
    const groups = groupRulesByCategory([rule('r1', 'a'), rule('r2', 'b'), rule('r3', 'a')], null)
    expect(groups.map((g) => g.rules.length)).toEqual([2, 1])
  })

  it('returns nothing for no rules', () => {
    expect(groupRulesByCategory([], categories)).toEqual([])
  })
})
