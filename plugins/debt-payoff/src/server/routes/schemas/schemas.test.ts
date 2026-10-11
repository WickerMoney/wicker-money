import { describe, expect, it } from 'vitest'
import { aprField } from './aprField.js'
import { createDebtBody } from './createDebtBody.js'
import { moneyField } from './moneyField.js'
import { planQuery } from './planQuery.js'
import { settingsBody } from './settingsBody.js'
import { updateDebtBody } from './updateDebtBody.js'

const ID = '00000000-0000-4000-8000-000000000001'
const base = { name: 'Visa', balance: '1000', apr: '24.99', minimumPayment: '35' }

describe('moneyField', () => {
  it.each([
    ['10', '10.0000'],
    ['10.5', '10.5000'],
    ['10.5000', '10.5000'],
    ['0', '0.0000'],
    ['  250.00 ', '250.0000'],
    ['999999999999999.9999', '999999999999999.9999'],
  ])('accepts %j as %j', (input, output) => {
    expect(moneyField.parse(input)).toBe(output)
  })

  it.each(['-1', '+1', '1,000', '1e3', '.5', '5.', '10.00001', '', ' ', 'abc', '1 000', '$5', '1000000000000000'])(
    'refuses %j',
    (input) => {
      expect(moneyField.safeParse(input).success).toBe(false)
    },
  )

  it('refuses a JSON number, and says to send text', () => {
    const result = moneyField.safeParse(10.5)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toMatch(/as text/)
  })

  it('refuses null, undefined and objects', () => {
    for (const value of [null, undefined, {}, [], true]) expect(moneyField.safeParse(value).success).toBe(false)
  })
})

describe('aprField', () => {
  it.each([
    ['24.99', '24.9900'],
    ['0', '0.0000'],
    ['999.9999', '999.9999'],
    ['5', '5.0000'],
  ])('accepts %j as %j', (input, output) => {
    expect(aprField.parse(input)).toBe(output)
  })

  it.each(['1000', '999.99991', '-1', '24,99', '', '12%'])('refuses %j', (input) => {
    expect(aprField.safeParse(input).success).toBe(false)
  })

  it('refuses a number', () => {
    expect(aprField.safeParse(24.99).success).toBe(false)
  })
})

describe('createDebtBody', () => {
  it('normalises amounts and trims the name', () => {
    expect(createDebtBody.parse({ ...base, name: '  Visa  ' })).toEqual({
      name: 'Visa', balance: '1000.0000', apr: '24.9900', minimumPayment: '35.0000',
    })
  })

  it('takes an account, a position and an archived flag', () => {
    expect(createDebtBody.parse({ ...base, accountId: ID, sortOrder: 3, archived: true })).toMatchObject({
      accountId: ID, sortOrder: 3, archived: true,
    })
    expect(createDebtBody.parse({ ...base, accountId: null })).toMatchObject({ accountId: null })
  })

  it.each([
    ['a missing field', { name: 'x', balance: '1', apr: '1' }],
    ['an unknown field', { ...base, minimum: '5' }],
    ['an empty name', { ...base, name: '   ' }],
    ['a name over 100 characters', { ...base, name: 'x'.repeat(101) }],
    ['a numeric balance', { ...base, balance: 1000 }],
    ['an account that is not an id', { ...base, accountId: 'checking' }],
    ['a fractional position', { ...base, sortOrder: 1.5 }],
    ['a negative position', { ...base, sortOrder: -1 }],
    ['a string archived flag', { ...base, archived: 'yes' }],
  ])('refuses %s', (_label, body) => {
    expect(createDebtBody.safeParse(body).success).toBe(false)
  })

  it('reports each problem on its own field', () => {
    const result = createDebtBody.safeParse({ ...base, balance: '-5', minimumPayment: 'lots' })
    expect(result.error?.issues.map((i) => i.path)).toEqual([['balance'], ['minimumPayment']])
  })
})

describe('updateDebtBody', () => {
  it('takes any one field', () => {
    expect(updateDebtBody.parse({ balance: '12' })).toEqual({ balance: '12.0000' })
    expect(updateDebtBody.parse({ accountId: null })).toEqual({ accountId: null })
    expect(updateDebtBody.parse({ archived: false })).toEqual({ archived: false })
  })

  it('refuses an empty update and unknown fields', () => {
    expect(updateDebtBody.safeParse({}).success).toBe(false)
    expect(updateDebtBody.safeParse({ name: 'x', extra: 1 }).success).toBe(false)
  })
})

describe('settingsBody', () => {
  it('takes either field or both', () => {
    expect(settingsBody.parse({ extraPayment: '100' })).toEqual({ extraPayment: '100.0000' })
    expect(settingsBody.parse({ strategy: 'snowball' })).toEqual({ strategy: 'snowball' })
    expect(settingsBody.parse({ extraPayment: '0', strategy: 'avalanche' })).toEqual({ extraPayment: '0.0000', strategy: 'avalanche' })
  })

  it('refuses nothing, an unknown strategy and a negative extra', () => {
    expect(settingsBody.safeParse({}).success).toBe(false)
    expect(settingsBody.safeParse({ strategy: 'fast' }).success).toBe(false)
    expect(settingsBody.safeParse({ extraPayment: '-1' }).success).toBe(false)
  })
})

describe('planQuery', () => {
  it('is all optional and ignores other parameters', () => {
    expect(planQuery.parse({})).toEqual({})
    expect(planQuery.parse({ strategy: 'snowball', extra: '50', tz: 'America/New_York', t: '123' })).toEqual({
      strategy: 'snowball', extra: '50.0000', tz: 'America/New_York',
    })
  })

  it('refuses an unknown strategy, a bad extra and an unknown time zone', () => {
    expect(planQuery.safeParse({ strategy: 'x' }).success).toBe(false)
    expect(planQuery.safeParse({ extra: '1,5' }).success).toBe(false)
    expect(planQuery.safeParse({ tz: 'Mars/Olympus' }).success).toBe(false)
  })
})
