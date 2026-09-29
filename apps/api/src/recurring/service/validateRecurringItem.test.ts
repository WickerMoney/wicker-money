import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../errors.js'
import type { LegAccount } from '../repository/LegAccount.js'
import type { RecurringItemInput } from './RecurringItemInput.js'
import { validateRecurringItem } from './validateRecurringItem.js'

const CHECKING = '11111111-1111-4111-8111-111111111111'
const SAVINGS = '22222222-2222-4222-8222-222222222222'
const CARD = '33333333-3333-4333-8333-333333333333'
const OLD = '44444444-4444-4444-8444-444444444444'

const ACCOUNTS: readonly LegAccount[] = [
  { id: CHECKING, account_type: 'checking', archived: false },
  { id: SAVINGS, account_type: 'savings', archived: false },
  { id: CARD, account_type: 'credit_card', archived: false },
  { id: OLD, account_type: 'checking', archived: true },
]

function input(over: Partial<RecurringItemInput> = {}): RecurringItemInput {
  return {
    name: 'Rent',
    kind: 'bill',
    frequency: 'monthly',
    seriesStartDate: '2026-01-01',
    legs: [{ accountId: CHECKING, amount: '-1550.0000' }],
    ...over,
  }
}

/** The message of the ValidationError `fn` throws. */
function failure(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError)
    return (e as Error).message
  }
  throw new Error('expected a ValidationError')
}

const check = (over: Partial<RecurringItemInput>, categoryExists = true) =>
  validateRecurringItem(input(over), ACCOUNTS, categoryExists)

describe('validateRecurringItem', () => {
  describe('accepts', () => {
    it('a bill, with canonical amounts', () => {
      expect(check({ legs: [{ accountId: CHECKING, amount: '-1550' }] }).legs).toEqual([
        { accountId: CHECKING, amount: '-1550.0000' },
      ])
    })

    it('a split paycheck', () => {
      const item = check({
        kind: 'income',
        legs: [{ accountId: CHECKING, amount: '1850' }, { accountId: SAVINGS, amount: '350' }],
      })
      expect(item.legs).toHaveLength(2)
    })

    it('a transfer and a debt payment', () => {
      expect(() => check({ kind: 'transfer', legs: [{ accountId: CHECKING, amount: '-200' }, { accountId: SAVINGS, amount: '200' }] }))
        .not.toThrow()
      expect(() => check({ kind: 'debt_payment', legs: [{ accountId: CHECKING, amount: '-400' }, { accountId: CARD, amount: '400.00' }] }))
        .not.toThrow()
    })

    it('a transfer to a card as a plain transfer', () => {
      expect(() => check({ kind: 'transfer', legs: [{ accountId: CHECKING, amount: '-50' }, { accountId: CARD, amount: '50' }] }))
        .not.toThrow()
    })
  })

  describe('semimonthly days', () => {
    it('default to the 1st and 15th', () => {
      expect(check({ frequency: 'semimonthly' }).semimonthlyDays).toEqual([1, 15])
    })

    it('are stored in order', () => {
      expect(check({ frequency: 'semimonthly', semimonthlyDays: [31, 15] }).semimonthlyDays).toEqual([15, 31])
    })

    it.each([
      [[0, 15], /1 to 31/],
      [[1, 32], /1 to 31/],
      [[15, 15], /must differ/],
      [[28, 31], /27 or less/],
    ] as const)('refuses %j', (days, message) => {
      expect(failure(() => check({ frequency: 'semimonthly', semimonthlyDays: days }))).toMatch(message)
    })

    it('are refused on any other frequency rather than silently dropped', () => {
      expect(failure(() => check({ semimonthlyDays: [1, 15] }))).toMatch(/Only a semimonthly/)
    })

    it('are null for other frequencies', () => {
      expect(check({}).semimonthlyDays).toBeNull()
    })
  })

  describe('refuses', () => {
    it.each<[string, Partial<RecurringItemInput>, RegExp]>([
      ['an end before the start', { endDate: '2025-12-31' }, /on or after seriesStartDate/],
      ['no legs', { legs: [] }, /At least one leg/],
      ['a zero leg', { legs: [{ accountId: CHECKING, amount: '0.00' }] }, /zero moves nothing/],
      ['the same account twice', { kind: 'transfer', legs: [{ accountId: CHECKING, amount: '-1' }, { accountId: CHECKING, amount: '1' }] }, /only once/],
      ['an unknown account', { legs: [{ accountId: '99999999-9999-4999-8999-999999999999', amount: '-1' }] }, /Account not found/],
      ['an archived account', { legs: [{ accountId: OLD, amount: '-1' }] }, /archived/],
      ['a positive bill', { legs: [{ accountId: CHECKING, amount: '95' }] }, /one negative amount/],
      ['a two-leg bill', { legs: [{ accountId: CHECKING, amount: '-50' }, { accountId: SAVINGS, amount: '-45' }] }, /one negative amount/],
      ['income with a negative leg', { kind: 'income', legs: [{ accountId: CHECKING, amount: '100' }, { accountId: SAVINGS, amount: '-20' }] }, /every leg must be positive/],
      ['a transfer that does not net to zero', { kind: 'transfer', legs: [{ accountId: CHECKING, amount: '-200' }, { accountId: SAVINGS, amount: '199.99' }] }, /cancel out/],
      ['a one-legged transfer', { kind: 'transfer', legs: [{ accountId: CHECKING, amount: '-200' }] }, /cancel out/],
      ['a debt payment into savings', { kind: 'debt_payment', legs: [{ accountId: CHECKING, amount: '-400' }, { accountId: SAVINGS, amount: '400' }] }, /credit card or loan/],
      ['a category on a transfer', { kind: 'transfer', categoryId: 'c', legs: [{ accountId: CHECKING, amount: '-1' }, { accountId: SAVINGS, amount: '1' }] }, /has no category/],
    ])('%s', (_, over, message) => {
      expect(failure(() => check(over))).toMatch(message)
    })

    it('a category that does not exist', () => {
      expect(failure(() => check({ categoryId: 'missing' }, false))).toMatch(/Category not found/)
    })
  })

  it('treats sub-cent precision exactly when netting a transfer', () => {
    // -0.3000 and 0.3 must cancel exactly, whatever their spelling.
    expect(() => check({
      kind: 'transfer',
      legs: [{ accountId: CHECKING, amount: '-0.3000' }, { accountId: SAVINGS, amount: '0.3' }],
    })).not.toThrow()
  })
})
