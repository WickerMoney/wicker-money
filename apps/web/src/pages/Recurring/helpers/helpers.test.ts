import { describe, expect, it } from 'vitest'
import type { RecurringItem } from '../../../models/index.js'
import { describeSchedule } from './describeSchedule.js'
import type { RecurringDraft } from '../state/RecurringDraft.js'
import { draftFromItem, emptyDraft, fieldForPath, payloadFromDraft } from './draft.js'
import { groupItems } from './groupItems.js'
import { dayLabel } from './ordinal.js'
import { previewDates } from './previewDates.js'

function item(over: Partial<RecurringItem>): RecurringItem {
  return {
    id: 'i', name: 'Rent', kind: 'bill', frequency: 'monthly', seriesStartDate: '2025-01-31', endDate: null,
    semimonthlyDays: null, categoryId: null, legs: [{ accountId: 'chk', amount: '-1550.0000' }],
    amount: '-1550.0000', monthlyEquivalent: '-1550.0000', nextDue: '2026-09-30', tracked: false, late: [], ...over,
  }
}

const TODAY = '2026-09-28'

describe('payloadFromDraft', () => {
  it('signs a bill negative from a positive amount, tolerating separators and a stray sign', () => {
    const built = payloadFromDraft({ ...emptyDraft(TODAY, 'chk'), name: ' Rent ', amount: '-1,550.00' })
    expect(built).toEqual({ payload: expect.objectContaining({
      name: 'Rent', legs: [{ accountId: 'chk', amount: '-1550.00' }], semimonthlyDays: null, endDate: null,
    }) })
  })

  it('builds a transfer as two legs netting to zero, and drops any category', () => {
    const built = payloadFromDraft({
      ...emptyDraft(TODAY, 'chk'), name: 'Vacation', kind: 'transfer', toAccountId: 'sav', amount: '200', categoryId: 'cat',
    })
    expect('payload' in built && built.payload).toMatchObject({
      categoryId: null,
      legs: [{ accountId: 'chk', amount: '-200' }, { accountId: 'sav', amount: '200' }],
    })
  })

  it('builds a split paycheck from the filled rows and ignores a blank one', () => {
    const built = payloadFromDraft({
      ...emptyDraft(TODAY), name: 'Pay', kind: 'income',
      splits: [{ accountId: 'chk', amount: '1850' }, { accountId: 'yr', amount: '350' }, { accountId: '', amount: '' }],
    })
    expect('payload' in built && built.payload.legs).toEqual([
      { accountId: 'chk', amount: '1850' }, { accountId: 'yr', amount: '350' },
    ])
  })

  it('sends semimonthly days only for semimonthly', () => {
    const semi = payloadFromDraft({ ...emptyDraft(TODAY, 'chk'), name: 'x', amount: '1', frequency: 'semimonthly', day1: '15', day2: '31' })
    expect('payload' in semi && semi.payload.semimonthlyDays).toEqual([15, 31])
  })

  it.each<[string, Partial<RecurringDraft>, Record<string, string>]>([
    ['no name', { name: '', amount: '5' }, { name: 'This cannot be empty.' }],
    ['a bill with no amount', { name: 'x', amount: '' }, { amount: 'This cannot be empty.' }],
    ['a bill of zero', { name: 'x', amount: '0.00' }, { amount: 'Must be more than 0.' }],
    ['a fifth decimal place', { name: 'x', amount: '9.99999' }, { amount: 'Enter an amount like 12.50, with no more than 4 decimal places.' }],
    ['a transfer with no destination', { name: 'x', kind: 'transfer', amount: '5' }, { toAccountId: 'Choose where the money goes.' }],
    ['a transfer to the account it leaves', { name: 'x', kind: 'transfer', toAccountId: 'chk', amount: '5' },
      { toAccountId: 'Choose a different account from the one the money leaves.' }],
    ['an income row missing its amount', { name: 'x', kind: 'income', splits: [{ accountId: 'chk', amount: '' }] },
      { 'splits.0.amount': 'This cannot be empty.' }],
    ['an end before the start', { name: 'x', amount: '5', endDate: '2026-01-01' }, { endDate: 'Must be on or after the first date.' }],
    ['two equal semimonthly days', { name: 'x', amount: '5', frequency: 'semimonthly', day1: '15', day2: '15' },
      { day2: 'The two days must differ.' }],
  ])('reports %s on its field', (_, patch, fields) => {
    const built = payloadFromDraft({ ...emptyDraft(TODAY, 'chk'), ...patch })
    expect('errors' in built && built.errors).toEqual({ fields, form: null })
  })
})

describe('fieldForPath', () => {
  it("maps the API's legs to the fields they were typed in", () => {
    const transfer = fieldForPath({ ...emptyDraft(TODAY, 'chk'), kind: 'transfer' })
    expect(transfer('legs.0.accountId')).toBe('fromAccountId')
    expect(transfer('legs.1.accountId')).toBe('toAccountId')
    expect(transfer('legs.1.amount')).toBe('amount')
    expect(transfer('legs')).toBeUndefined()

    // A blank middle row is not sent, so the second leg is the third row.
    const income = fieldForPath({
      ...emptyDraft(TODAY), kind: 'income',
      splits: [{ accountId: 'chk', amount: '1' }, { accountId: '', amount: '' }, { accountId: 'sav', amount: '2' }],
    })
    expect(income('legs.1.amount')).toBe('splits.2.amount')
    expect(income('semimonthlyDays')).toBeUndefined()
    expect(fieldForPath({ ...emptyDraft(TODAY), frequency: 'semimonthly' })('semimonthlyDays')).toBe('day2')
    expect(fieldForPath({ ...emptyDraft(TODAY), kind: 'transfer' })('categoryId')).toBeUndefined()
  })
})

describe('draftFromItem', () => {
  it('round-trips a transfer: from, to and the positive amount', () => {
    const draft = draftFromItem(item({
      kind: 'transfer', legs: [{ accountId: 'chk', amount: '-200.0000' }, { accountId: 'sav', amount: '200.0000' }], amount: '200.0000',
    }))
    expect(draft).toMatchObject({ fromAccountId: 'chk', toAccountId: 'sav', amount: '200.0000' })
    const again = payloadFromDraft(draft)
    expect('payload' in again && again.payload.legs).toEqual([
      { accountId: 'chk', amount: '-200.0000' }, { accountId: 'sav', amount: '200.0000' },
    ])
  })

  it('round-trips a bill and a split paycheck', () => {
    expect(draftFromItem(item({}))).toMatchObject({ fromAccountId: 'chk', amount: '1550.0000', endDate: '' })
    const pay = draftFromItem(item({
      kind: 'income', legs: [{ accountId: 'chk', amount: '1850.0000' }, { accountId: 'yr', amount: '350.0000' }],
    }))
    expect(pay.splits).toEqual([{ accountId: 'chk', amount: '1850.0000' }, { accountId: 'yr', amount: '350.0000' }])
  })
})

describe('describeSchedule', () => {
  it.each([
    [item({ frequency: 'biweekly' }), 'Every 2 weeks'],
    [item({ frequency: 'semimonthly', semimonthlyDays: [15, 31] }), 'Twice a month · 15th & last day'],
    [item({ endDate: '2026-12-31' }), 'Monthly · until 2026-12-31'],
    [item({ frequency: 'once', endDate: '2026-12-31' }), 'Once'],
  ])('%#', (i, text) => {
    expect(describeSchedule(i)).toBe(text)
  })
})

describe('dayLabel', () => {
  it.each([[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [11, '11th'], [12, '12th'], [13, '13th'], [21, '21st'], [22, '22nd'], [23, '23rd'], [31, 'last day']])(
    '%i → %s', (d, text) => { expect(dayLabel(d)).toBe(text) },
  )
})

describe('groupItems', () => {
  it('puts debt payments with bills and keeps transfers apart', () => {
    const g = groupItems([
      item({ id: 'a', kind: 'income' }), item({ id: 'b', kind: 'debt_payment' }),
      item({ id: 'c', kind: 'transfer' }), item({ id: 'd', kind: 'bill' }),
    ])
    expect([g.income, g.outgoing, g.transfers].map((xs) => xs.map((x) => x.id))).toEqual([['a'], ['b', 'd'], ['c']])
  })
})

describe('previewDates', () => {
  it('counts from the server\'s today, clamping month ends', () => {
    expect(previewDates({ ...emptyDraft(TODAY), seriesStartDate: '2025-01-31' }, TODAY, 3))
      .toEqual(['2026-09-30', '2026-10-31', '2026-11-30'])
  })

  it('shows one date for a one-off and none once it has passed', () => {
    expect(previewDates({ ...emptyDraft(TODAY), frequency: 'once', seriesStartDate: '2026-10-05' }, TODAY)).toEqual(['2026-10-05'])
    expect(previewDates({ ...emptyDraft(TODAY), frequency: 'once', seriesStartDate: '2026-09-01' }, TODAY)).toEqual([])
  })

  it('is null while the schedule is invalid', () => {
    expect(previewDates({ ...emptyDraft(TODAY), frequency: 'semimonthly', day1: '28', day2: '31' }, TODAY)).toBeNull()
    expect(previewDates({ ...emptyDraft(TODAY), seriesStartDate: '' }, TODAY)).toBeNull()
  })
})
