import { describe, expect, it } from 'vitest'
import { matches } from '../engine.js'
import type { ConditionInput } from './ConditionInput.js'
import { toConditionColumns } from './toConditionColumns.js'

const NONE = { direction: null, amount_value: null, amount_min: null, amount_max: null, text_value: null }

describe('toConditionColumns', () => {
  it.each(['merchant_exact', 'merchant_contains', 'description_contains'] as const)(
    'maps %s to the text columns and nulls the amount columns',
    (conditionType) => {
      expect(toConditionColumns({ conditionType, textValue: 'Coffee', isCaseSensitive: true })).toEqual({
        ...NONE, condition_type: conditionType, text_value: 'Coffee', is_case_sensitive: true,
      })
      expect(toConditionColumns({ conditionType, textValue: 'x', isCaseSensitive: false })).toMatchObject({
        is_case_sensitive: false,
      })
    },
  )

  it('maps amount_exact to a magnitude and direction, never case-sensitive', () => {
    expect(toConditionColumns({ conditionType: 'amount_exact', direction: 'out', amountValue: '375.0000' })).toEqual({
      ...NONE, condition_type: 'amount_exact', is_case_sensitive: false, direction: 'out', amount_value: '375.0000',
    })
  })

  it('maps amount_range with both bounds', () => {
    expect(
      toConditionColumns({ conditionType: 'amount_range', direction: 'in', amountMin: '1.0000', amountMax: '9.0000' }),
    ).toEqual({
      ...NONE, condition_type: 'amount_range', is_case_sensitive: false, direction: 'in',
      amount_min: '1.0000', amount_max: '9.0000',
    })
  })

  it('turns an absent or null bound into null, so an open-ended range keeps working', () => {
    const minOnly = toConditionColumns({ conditionType: 'amount_range', direction: 'out', amountMin: '500.0000' })
    expect(minOnly).toMatchObject({ amount_min: '500.0000', amount_max: null })

    const maxOnly = toConditionColumns({
      conditionType: 'amount_range', direction: 'out', amountMin: null, amountMax: '20.0000',
    })
    expect(maxOnly).toMatchObject({ amount_min: null, amount_max: '20.0000' })

    expect(matches([minOnly], { merchant: 'x', amount: '-600.0000' })).toBe(true)
    expect(matches([minOnly], { merchant: 'x', amount: '-100.0000' })).toBe(false)
  })

  it('produces columns the matching engine understands for every type', () => {
    const cases: [ConditionInput, { merchant: string; notes?: string; amount: string }][] = [
      [{ conditionType: 'merchant_exact', textValue: 'acme', isCaseSensitive: false }, { merchant: 'ACME', amount: '-1' }],
      [{ conditionType: 'merchant_contains', textValue: 'cm', isCaseSensitive: false }, { merchant: 'Acme', amount: '-1' }],
      [{ conditionType: 'description_contains', textValue: 'rent', isCaseSensitive: false }, { merchant: 'x', notes: 'Rent', amount: '-1' }],
      [{ conditionType: 'amount_exact', direction: 'in', amountValue: '5' }, { merchant: 'x', amount: '5.0000' }],
      [{ conditionType: 'amount_range', direction: 'out', amountMin: '1', amountMax: '3' }, { merchant: 'x', amount: '-2' }],
    ]
    for (const [input, subject] of cases) {
      expect(matches([toConditionColumns(input)], subject), input.conditionType).toBe(true)
    }
  })
})
