import { describe, expect, it } from 'vitest'
import type { RuleCondition } from '../../../models/index.js'
import { describeCondition } from './describeCondition.js'

function condition(patch: Partial<RuleCondition>): RuleCondition {
  return {
    id: 'c1', condition_type: 'merchant_contains', text_value: null, is_case_sensitive: false,
    direction: null, amount_value: null, amount_min: null, amount_max: null, ...patch,
  }
}

describe('describeCondition', () => {
  it('describes the text conditions, noting case sensitivity', () => {
    expect(describeCondition(condition({ condition_type: 'merchant_contains', text_value: 'COFFEE' })))
      .toBe("Merchant contains 'COFFEE'")
    expect(describeCondition(condition({ condition_type: 'merchant_exact', text_value: 'Shell', is_case_sensitive: true })))
      .toBe("Merchant is exactly 'Shell' (case-sensitive)")
    expect(describeCondition(condition({ condition_type: 'description_contains', text_value: 'rent' })))
      .toBe("Notes contain 'rent'")
  })

  it('describes an exact amount with its direction', () => {
    expect(describeCondition(condition({ condition_type: 'amount_exact', direction: 'in', amount_value: '5.00' })))
      .toBe('Amount in exactly 5.00')
    expect(describeCondition(condition({ condition_type: 'amount_exact', direction: 'out', amount_value: '375.00' })))
      .toBe('Amount out exactly 375.00')
  })

  it('describes every shape of amount range', () => {
    const range = (min: string | null, max: string | null) =>
      describeCondition(condition({ condition_type: 'amount_range', direction: 'out', amount_min: min, amount_max: max }))
    expect(range('10', '20')).toBe('Amount out between 10 and 20')
    expect(range('10', null)).toBe('Amount out, at least 10')
    expect(range(null, '20')).toBe('Amount out, at most 20')
    expect(range(null, null)).toBe('Amount out (range)')
  })
})
