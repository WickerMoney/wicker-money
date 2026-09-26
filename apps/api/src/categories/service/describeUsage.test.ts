import { describe, expect, it } from 'vitest'
import type { CategoryUsage } from './CategoryUsage.js'
import { describeUsage } from './describeUsage.js'

const usage = (by: CategoryUsage['by'], childCount = 0): CategoryUsage => ({
  total: by.reduce((n, b) => n + b.count, childCount), by, unreadable: [], childCount,
})

describe('describeUsage', () => {
  it('singularises one and pluralises many', () => {
    expect(describeUsage(usage([{ table: 'core.transactions', count: 1 }]))).toBe('1 transaction')
    expect(describeUsage(usage([{ table: 'core.transactions', count: 2 }]))).toBe('2 transactions')
  })

  it('joins several parts with commas and a final "and"', () => {
    expect(
      describeUsage(
        usage([
          { table: 'core.transactions', count: 3 },
          { table: 'core.category_rules', count: 1 },
          { table: 'core.transaction_splits', count: 2 },
        ], 2),
      ),
    ).toBe('3 transactions, 1 rule, 2 splits and 2 child categories')
  })

  it('uses two parts without a comma', () => {
    expect(describeUsage(usage([{ table: 'core.recurring_items', count: 1 }], 1))).toBe(
      '1 recurring item and 1 child category',
    )
  })

  it('names an unknown table as-is, never pluralised', () => {
    expect(describeUsage(usage([{ table: 'plugin_x.things', count: 4 }]))).toBe('4 plugin_x.things')
  })

  it('describes children alone', () => {
    expect(describeUsage(usage([], 2))).toBe('2 child categories')
  })

  it('admits when nothing readable holds it', () => {
    expect(describeUsage(usage([]))).toBe('something this connection cannot see')
  })
})
