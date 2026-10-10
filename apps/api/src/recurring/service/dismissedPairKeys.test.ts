import { describe, expect, it } from 'vitest'
import { dismissedPairKeys } from './dismissedPairKeys.js'
import { pairKey } from './pairKey.js'

describe('dismissedPairKeys', () => {
  it('is empty for no dismissals', () => {
    expect(dismissedPairKeys([]).size).toBe(0)
  })

  it('holds the pair key of each dismissal and nothing else', () => {
    const keys = dismissedPairKeys([
      { transaction_id: 't1', recurring_item_id: 'rent', nominal_date: '2026-10-01' },
      { transaction_id: 't2', recurring_item_id: 'rent', nominal_date: '2026-10-01' },
    ])
    expect(keys.size).toBe(2)
    expect(keys.has(pairKey('t1', 'rent', '2026-10-01'))).toBe(true)
    expect(keys.has(pairKey('t2', 'rent', '2026-10-01'))).toBe(true)
  })

  it('excludes only the exact pair: the same transaction stays open to other occurrences', () => {
    const keys = dismissedPairKeys([{ transaction_id: 't1', recurring_item_id: 'rent', nominal_date: '2026-10-01' }])
    expect(keys.has(pairKey('t1', 'rent', '2026-11-01'))).toBe(false)
    expect(keys.has(pairKey('t1', 'power', '2026-10-01'))).toBe(false)
    expect(keys.has(pairKey('t9', 'rent', '2026-10-01'))).toBe(false)
  })

  it('collapses a repeated dismissal', () => {
    const d = { transaction_id: 't1', recurring_item_id: 'rent', nominal_date: '2026-10-01' }
    expect(dismissedPairKeys([d, d]).size).toBe(1)
  })
})
