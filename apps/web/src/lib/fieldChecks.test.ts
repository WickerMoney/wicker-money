import { describe, expect, it } from 'vitest'
import { checkMoney, checkText, fieldErrors, isZeroAmount, MONEY_FORMAT_MESSAGE } from './fieldChecks.js'

describe('checkMoney', () => {
  it.each(['12.50', '-4.5', '0', ' 7 ', '999999999999999.9999'])('accepts %j', (text) => {
    expect(checkMoney(text)).toBeUndefined()
  })

  it.each(['12.34567', '1,000', 'abc', '.5', '5.', '+5', '1e3', '1000000000000000'])('refuses %j as the API does', (text) => {
    expect(checkMoney(text)).toBe(MONEY_FORMAT_MESSAGE)
  })

  it('says a blank amount is required', () => {
    expect(checkMoney('  ')).toBe('This cannot be empty.')
  })

  it('refuses zero and below for a positive amount, in the words given', () => {
    expect(checkMoney('0', 'positive')).toBe('Must be more than 0.')
    expect(checkMoney('-1', 'positive', 'Nope.')).toBe('Nope.')
    expect(checkMoney('0.0001', 'positive')).toBeUndefined()
  })

  it('refuses a negative amount where only zero or more makes sense', () => {
    expect(checkMoney('-0.01', 'nonNegative')).toBe('Cannot be negative.')
    expect(checkMoney('0', 'nonNegative')).toBeUndefined()
  })
})

describe('isZeroAmount', () => {
  it('knows every spelling of zero, and nothing else', () => {
    expect(['0', '0.00', '-0', ' 0.0000 '].every(isZeroAmount)).toBe(true)
    expect(['', '0.01', 'zero'].some(isZeroAmount)).toBe(false)
  })
})

describe('checkText', () => {
  it('refuses blank text and text over the limit', () => {
    expect(checkText('   ')).toBe('This cannot be empty.')
    expect(checkText('abcd', 3)).toBe('Must be 3 characters or fewer.')
    expect(checkText(' abc ', 3)).toBeUndefined()
  })
})

describe('fieldErrors', () => {
  it('keeps only the fields that failed', () => {
    expect(fieldErrors({ name: undefined, amount: 'Must be more than 0.' }))
      .toEqual({ fields: { amount: 'Must be more than 0.' }, form: null })
  })
})
