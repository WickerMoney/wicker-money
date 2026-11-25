import { describe, expect, it } from 'vitest'
import type { WhatIfResult } from '../../shared/index.js'
import { checkLumpSumDraft, partField } from './checkLumpSumDraft.js'
import { draftFromLumpSum } from './draftFromLumpSum.js'
import { EMPTY_LUMP_DRAFT } from './EMPTY_LUMP_DRAFT.js'
import { lumpSumBody, whatIfBody } from './lumpSumBody.js'
import { lumpSumStatus } from './lumpSumStatus.js'
import { whatIfSentence } from './whatIfSentence.js'

const money = (v: string) => `$${v}`
const date = (v: string) => v
const ok = { onDate: '2027-01-10', amount: '100', note: '', allocations: {} }

describe('checkLumpSumDraft', () => {
  it('accepts a good form', () => {
    expect(checkLumpSumDraft(ok)).toEqual({ fields: {}, form: null })
  })

  it('names each empty or wrong field', () => {
    const r = checkLumpSumDraft(EMPTY_LUMP_DRAFT)
    expect(r.fields['onDate']).toBe('Enter the date.')
    expect(r.fields['amount']).toBe('Enter an amount.')
    expect(checkLumpSumDraft({ ...ok, onDate: '2027-02-30' }).fields['onDate']).toMatch(/exists on the calendar/)
    expect(checkLumpSumDraft({ ...ok, amount: '1,000' }).fields['amount']).toMatch(/at most four decimal places/)
  })

  it('refuses zero for the amount and for a part, but lets a part be blank', () => {
    expect(checkLumpSumDraft({ ...ok, amount: '0.00' }).fields['amount']).toMatch(/more than zero/)
    const zero = checkLumpSumDraft({ ...ok, allocations: { a: '0', b: '  ' } })
    expect(zero.fields[partField('a')]).toMatch(/more than zero/)
    expect(zero.fields[partField('b')]).toBeUndefined()
  })

  it('counts the parts exactly, and allows parts equal to the whole', () => {
    expect(checkLumpSumDraft({ ...ok, amount: '0.3', allocations: { a: '0.1', b: '0.2' } }).form).toBeNull()
    expect(checkLumpSumDraft({ ...ok, amount: '0.3', allocations: { a: '0.1', b: '0.2001' } }).form)
      .toMatch(/add up to more than/)
  })

  it('limits the note, except in the what-if', () => {
    const long = { ...ok, note: 'x'.repeat(201) }
    expect(checkLumpSumDraft(long).fields['note']).toMatch(/200/)
    expect(checkLumpSumDraft(long, { withNote: false }).fields['note']).toBeUndefined()
  })
})

describe('lumpSumBody', () => {
  it('trims, keeps money as text, and orders and filters the parts by debt order', () => {
    expect(lumpSumBody({ onDate: ' 2027-01-10 ', amount: ' 10.50 ', note: ' hi ', allocations: { b: '1', a: ' ', c: '2' } }, ['a', 'b']))
      .toEqual({ onDate: '2027-01-10', amount: '10.50', note: 'hi', allocations: [{ debtId: 'b', amount: '1' }, { debtId: 'c', amount: '2' }] })
  })

  it('drops the note from a what-if', () => {
    expect(whatIfBody(ok, [])).toEqual({ onDate: '2027-01-10', amount: '100', allocations: [] })
  })
})

describe('draftFromLumpSum', () => {
  it('shows cents, and all four places only when there are sub-cent digits', () => {
    expect(draftFromLumpSum({
      id: 'x', onDate: '2027-01-10', amount: '10.5000', note: 'n', allocations: [{ debtId: 'a', amount: '0.0050' }],
    })).toEqual({ onDate: '2027-01-10', amount: '10.50', note: 'n', allocations: { a: '0.0050' } })
  })
})

const outcome = (over: Partial<Parameters<typeof lumpSumStatus>[0] & object> = {}) => ({
  id: 'x', onDate: '2027-01-10', amount: '100.0000', status: 'applied' as const, month: 3, date: '2027-01-10',
  paid: '100.0000', unused: '0.0000', ...over,
})

describe('lumpSumStatus', () => {
  it('describes each outcome in words', () => {
    expect(lumpSumStatus(undefined, money, date)).toBe('…')
    expect(lumpSumStatus(outcome(), money, date)).toBe('Paid on 2027-01-10 in the plan.')
    expect(lumpSumStatus(outcome({ status: 'past', paid: '0.0000', unused: '100.0000', month: null, date: null }), money, date))
      .toMatch(/The date has passed/)
    expect(lumpSumStatus(outcome({ status: 'beyond_limit', paid: '0.0000', month: null, date: null }), money, date))
      .toMatch(/after the plan ends/)
    expect(lumpSumStatus(outcome({ paid: '60.0000', unused: '40.0000' }), money, date))
      .toMatch(/\$60\.0000 used, \$40\.0000 not needed/)
    expect(lumpSumStatus(outcome({ paid: '0.0000', unused: '100.0000' }), money, date)).toMatch(/Not needed/)
  })
})

const summary = (d: string | null, months: number, interest: string) => ({ debtFreeDate: d, months, totalInterest: interest, capped: d === null })

describe('whatIfSentence', () => {
  const base: WhatIfResult = {
    current: summary('2027-06-10', 8, '50.0000'),
    withLumpSum: summary('2027-03-10', 5, '30.0000'),
    interestSaved: '20.0000',
    monthsSaved: 3,
    lumpSum: outcome(),
  }

  it('states the date, the months and the interest saved', () => {
    expect(whatIfSentence(base, money, date))
      .toBe('With $100.0000 on 2027-01-10 you would be debt free on 2027-03-10, 5 months from now: 3 months sooner, saving $20.0000 in interest.')
  })

  it('says when the date is the same and mentions money that was not needed', () => {
    const s = whatIfSentence({ ...base, monthsSaved: 0, interestSaved: '0.0000', lumpSum: outcome({ unused: '10.0000', paid: '90.0000' }) }, money, date)
    expect(s).toMatch(/the same date, saving no interest\./)
    expect(s).toMatch(/\$10\.0000 of it would not be needed/)
  })

  it('handles a plan that never ends, with or without the lump sum', () => {
    expect(whatIfSentence({ ...base, current: summary(null, 600, '1.0000'), interestSaved: null, monthsSaved: null }, money, date))
      .toMatch(/Without it the plan does not reach zero/)
    expect(whatIfSentence({ ...base, withLumpSum: summary(null, 600, '1.0000'), interestSaved: null, monthsSaved: null }, money, date))
      .toMatch(/Even with \$100\.0000 .* does not reach zero/)
  })

  it('says a past or beyond-limit candidate changes nothing', () => {
    expect(whatIfSentence({ ...base, lumpSum: outcome({ status: 'past' }) }, money, date)).toMatch(/has passed/)
    expect(whatIfSentence({ ...base, lumpSum: outcome({ status: 'beyond_limit' }) }, money, date)).toMatch(/after the plan ends/)
  })
})
