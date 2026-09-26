import { describe, expect, it } from 'vitest'
import {
  matches,
  matchesCondition,
  resolveCategory,
  type MatchCondition,
  type MatchRule,
} from './engine.js'
import { fetchRulesInResolutionOrder } from './repository/rules/fetchRulesInResolutionOrder.js'
import type { FlatRuleConditionRow } from './repository/rules/FlatRuleConditionRow.js'
import { groupRulesInResolutionOrder } from './repository/rules/groupRulesInResolutionOrder.js'

function textCondition(over: Partial<MatchCondition> = {}): MatchCondition {
  return {
    condition_type: 'merchant_contains',
    text_value: 'coffee',
    is_case_sensitive: false,
    direction: null,
    amount_value: null,
    amount_min: null,
    amount_max: null,
    ...over,
  }
}

function amountCondition(over: Partial<MatchCondition> = {}): MatchCondition {
  return {
    condition_type: 'amount_exact',
    text_value: null,
    is_case_sensitive: false,
    direction: 'out',
    amount_value: '375.0000',
    amount_min: null,
    amount_max: null,
    ...over,
  }
}

describe('matchesCondition — text', () => {
  it('matches merchant exactly', () => {
    const c = textCondition({ condition_type: 'merchant_exact', text_value: 'Blue Bottle' })
    expect(matchesCondition(c, { merchant: 'Blue Bottle', amount: '-5.0000' })).toBe(true)
    expect(matchesCondition(c, { merchant: 'Blue Bottle Coffee', amount: '-5.0000' })).toBe(false)
  })

  it('is case-insensitive by default', () => {
    expect(matchesCondition(textCondition(), { merchant: 'MORNING COFFEE CO', amount: '-5' })).toBe(true)
  })

  it('respects case sensitivity when asked', () => {
    const c = textCondition({ is_case_sensitive: true, text_value: 'Coffee' })
    expect(matchesCondition(c, { merchant: 'morning coffee', amount: '-5' })).toBe(false)
    expect(matchesCondition(c, { merchant: 'morning Coffee', amount: '-5' })).toBe(true)
  })

  it('does not match description conditions against blank notes', () => {
    const c = textCondition({ condition_type: 'description_contains', text_value: 'x' })
    expect(matchesCondition(c, { merchant: 'anything', notes: null, amount: '-5' })).toBe(false)
    expect(matchesCondition(c, { merchant: 'anything', notes: '   ', amount: '-5' })).toBe(false)
  })
})

describe('matchesCondition — amount', () => {
  it('matches an exact magnitude, direction out, against a negative amount', () => {
    const c = amountCondition()
    expect(matchesCondition(c, { merchant: 'CHECK', amount: '-375.0000' })).toBe(true)
    expect(matchesCondition(c, { merchant: 'CHECK', amount: '-375.01' })).toBe(false)
  })

  it('rejects a matching magnitude on the wrong side of zero', () => {
    const c = amountCondition({ direction: 'out' })
    expect(matchesCondition(c, { merchant: 'CHECK', amount: '375.0000' })).toBe(false)
  })

  it('direction in requires a positive amount', () => {
    const c = amountCondition({ direction: 'in', amount_value: '50.0000' })
    expect(matchesCondition(c, { merchant: 'Employer', amount: '50.0000' })).toBe(true)
    expect(matchesCondition(c, { merchant: 'Employer', amount: '-50.0000' })).toBe(false)
  })

  it('never matches a zero amount, either direction', () => {
    const out = amountCondition({ direction: 'out' })
    const inn = amountCondition({ direction: 'in' })
    expect(matchesCondition(out, { merchant: 'x', amount: '0.0000' })).toBe(false)
    expect(matchesCondition(inn, { merchant: 'x', amount: '0.0000' })).toBe(false)
  })

  it('matches an amount_range with both bounds', () => {
    const c = amountCondition({ condition_type: 'amount_range', amount_value: null, amount_min: '40.0000', amount_max: '60.0000' })
    expect(matchesCondition(c, { merchant: 'x', amount: '-50.0000' })).toBe(true)
    expect(matchesCondition(c, { merchant: 'x', amount: '-39.9999' })).toBe(false)
    expect(matchesCondition(c, { merchant: 'x', amount: '-60.0001' })).toBe(false)
  })

  it('allows an open-ended range on either side', () => {
    const atLeast = amountCondition({ condition_type: 'amount_range', amount_value: null, amount_min: '500.0000', amount_max: null })
    expect(matchesCondition(atLeast, { merchant: 'x', amount: '-10000.0000' })).toBe(true)
    expect(matchesCondition(atLeast, { merchant: 'x', amount: '-499.9999' })).toBe(false)

    const atMost = amountCondition({ condition_type: 'amount_range', amount_value: null, amount_min: null, amount_max: '20.0000' })
    expect(matchesCondition(atMost, { merchant: 'x', amount: '-5.0000' })).toBe(true)
    expect(matchesCondition(atMost, { merchant: 'x', amount: '-20.0001' })).toBe(false)
  })
})

describe('matches — AND across conditions', () => {
  it('the cheque case: merchant contains CHECK AND amount out exactly 375.00', () => {
    const conditions = [
      textCondition({ condition_type: 'merchant_contains', text_value: 'CHECK' }),
      amountCondition(),
    ]
    expect(matches(conditions, { merchant: 'CHECK #1042', amount: '-375.0000' })).toBe(true)
    // Same merchant text, different amount — a different cheque, not this rule.
    expect(matches(conditions, { merchant: 'CHECK #1043', amount: '-200.0000' })).toBe(false)
    // Same amount, different merchant.
    expect(matches(conditions, { merchant: 'Amazon', amount: '-375.0000' })).toBe(false)
  })

  it('a rule with zero conditions never matches', () => {
    expect(matches([], { merchant: 'anything', amount: '-1.0000' })).toBe(false)
  })
})

describe('resolveCategory', () => {
  function rule(over: Partial<MatchRule> = {}): MatchRule {
    return { category_id: 'c1', conditions: [textCondition()], ...over }
  }

  it('returns null when nothing matches', () => {
    expect(resolveCategory([rule()], { merchant: 'Hardware store', amount: '-40' })).toBeNull()
  })

  it('takes the first match in the order given', () => {
    const high = rule({ category_id: 'cat-high' })
    const low = rule({ category_id: 'cat-low' })
    expect(resolveCategory([high, low], { merchant: 'coffee', amount: '-5' })).toBe('cat-high')
  })

  it('resolves the cheque case correctly against a mixed rule set', () => {
    const generalCheck = rule({
      category_id: 'cat-general',
      conditions: [textCondition({ condition_type: 'merchant_contains', text_value: 'CHECK' })],
    })
    const carPayment = rule({
      category_id: 'cat-car',
      conditions: [
        textCondition({ condition_type: 'merchant_contains', text_value: 'CHECK' }),
        amountCondition(),
      ],
    })
    // Caller orders by priority DESC, condition_count DESC, created_at ASC —
    // the two-condition rule sorts before the one-condition rule when both
    // share priority, which is the tiebreak this order encodes.
    expect(resolveCategory([carPayment, generalCheck], { merchant: 'CHECK #1042', amount: '-375.0000' })).toBe(
      'cat-car',
    )
    expect(resolveCategory([carPayment, generalCheck], { merchant: 'CHECK #1099', amount: '-60.0000' })).toBe(
      'cat-general',
    )
  })
})

describe('groupRulesInResolutionOrder', () => {
  function row(over: Partial<FlatRuleConditionRow> = {}): FlatRuleConditionRow {
    return {
      rule_id: 'r1',
      category_id: 'c1',
      condition_type: 'merchant_contains',
      text_value: 'coffee',
      is_case_sensitive: false,
      direction: null,
      amount_value: null,
      amount_min: null,
      amount_max: null,
      ...over,
    }
  }

  it('groups multiple condition rows into one rule, preserving row order for rules', () => {
    const rows: FlatRuleConditionRow[] = [
      row({ rule_id: 'r2', category_id: 'cat-2' }),
      row({ rule_id: 'r1', category_id: 'cat-1', condition_type: 'merchant_contains', text_value: 'CHECK' }),
      row({ rule_id: 'r1', category_id: 'cat-1', condition_type: 'amount_exact', text_value: null, direction: 'out', amount_value: '375.0000' }),
    ]
    const grouped = groupRulesInResolutionOrder(rows)
    expect(grouped.map((r) => r.category_id)).toEqual(['cat-2', 'cat-1'])
    expect(grouped[1]?.conditions).toHaveLength(2)
  })

  it('returns an empty array for no rows', () => {
    expect(groupRulesInResolutionOrder([])).toEqual([])
  })
})

describe('fetchRulesInResolutionOrder', () => {
  it('queries with the runner and groups the result', async () => {
    const flat: FlatRuleConditionRow = {
      rule_id: 'r1',
      category_id: 'cat-1',
      condition_type: 'merchant_contains',
      text_value: 'coffee',
      is_case_sensitive: false,
      direction: null,
      amount_value: null,
      amount_min: null,
      amount_max: null,
    }
    let sawQuery = false
    const run = async <T,>(strings: TemplateStringsArray): Promise<T[]> => {
      sawQuery = strings.join('').includes('category_rule_conditions')
      return [flat] as unknown as T[]
    }
    const rules = await fetchRulesInResolutionOrder(run)
    expect(sawQuery).toBe(true)
    expect(rules).toEqual([{ category_id: 'cat-1', conditions: [expect.objectContaining({ text_value: 'coffee' })] }])
  })
})
