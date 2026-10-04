import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ruleBody } from '../categories/routes/schemas/index.js'
import { ValidationError } from '../errors.js'
import { parseBody } from './parseBody.js'

/** The ValidationError `parseBody` throws for a value, or a failure if it does not throw. */
function rejection(schema: z.ZodType<unknown>, value: unknown): ValidationError {
  try {
    parseBody(schema, value)
  } catch (error) {
    if (error instanceof ValidationError) return error
    throw error
  }
  throw new Error('expected parseBody to throw')
}

const RULE_CATEGORY = '00000000-0000-4000-8000-000000000001'

describe('parseBody', () => {
  it('returns the parsed value when it is valid', () => {
    expect(parseBody(z.object({ n: z.number() }), { n: 1 })).toEqual({ n: 1 })
  })

  it('lists every issue with its path, and keeps the joined top-level message', () => {
    const error = rejection(
      z.object({ name: z.string().trim().min(1), when: z.string().uuid() }),
      { name: '  ', when: 'soon' },
    )

    expect(error.issues).toEqual([
      { path: ['name'], message: 'This cannot be empty.' },
      { path: ['when'], message: 'Must be a valid id.' },
    ])
    expect(error.message).toBe('name: This cannot be empty.; when: Must be a valid id.')
  })

  it('words the zero "At least" of a rule as a sentence about that box, not a schema path', () => {
    const error = rejection(ruleBody, {
      categoryId: RULE_CATEGORY,
      conditions: [{ conditionType: 'amount_range', direction: 'out', amountMin: '0' }],
    })

    expect(error.issues).toEqual([
      { path: ['conditions', 0, 'amountMin'], message: 'Must be more than 0. Leave it empty for no minimum.' },
    ])
  })

  it('refuses a fifth decimal place in a rule amount', () => {
    const error = rejection(ruleBody, {
      categoryId: RULE_CATEGORY,
      conditions: [{ conditionType: 'amount_exact', direction: 'out', amountValue: '1.23456' }],
    })

    expect(error.issues[0]).toEqual({
      path: ['conditions', 0, 'amountValue'],
      message: 'Enter an amount like 12.50, with no more than 4 decimal places.',
    })
  })

  it('puts a range whose maximum is under its minimum on the maximum', () => {
    const error = rejection(ruleBody, {
      categoryId: RULE_CATEGORY,
      conditions: [{ conditionType: 'amount_range', direction: 'out', amountMin: '50', amountMax: '10' }],
    })

    expect(error.issues).toEqual([
      { path: ['conditions', 0, 'amountMax'], message: 'Cannot be less than the minimum.' },
    ])
  })

  it('lets a message the schema sets itself win over the generic wording', () => {
    const error = rejection(z.object({ p: z.string().min(12, 'Password must be at least 12 characters.') }), { p: 'short' })

    expect(error.issues).toEqual([{ path: ['p'], message: 'Password must be at least 12 characters.' }])
  })

  it.each<[string, z.ZodType<unknown>, unknown, string]>([
    ['a missing field', z.object({ a: z.string() }), {}, 'This is required.'],
    ['a null field', z.object({ a: z.string() }), { a: null }, 'This cannot be empty.'],
    ['the wrong type', z.object({ a: z.number() }), { a: 'x' }, 'Must be a number.'],
    ['a fraction where a whole number goes', z.object({ a: z.number().int() }), { a: 1.5 }, 'Must be a whole number.'],
    ['a string too long', z.object({ a: z.string().max(3) }), { a: 'abcd' }, 'Must be 3 characters or fewer.'],
    ['a number too small', z.object({ a: z.number().min(1) }), { a: 0 }, 'Must be 1 or more.'],
    ['an empty list', z.object({ a: z.array(z.string()).min(1) }), { a: [] }, 'Add at least one.'],
    ['an unknown option', z.object({ a: z.enum(['in', 'out']) }), { a: 'up' }, 'Must be one of: in, out.'],
  ])('words %s as a sentence', (_, schema, value, message) => {
    expect(rejection(schema, value).issues[0]?.message).toBe(message)
  })

  it('reports a problem with the whole body with an empty path and no prefix', () => {
    const error = rejection(z.object({}).strict(), { extra: 1 })

    expect(error.issues).toEqual([{ path: [], message: 'Not a field this accepts: extra.' }])
    expect(error.message).toBe('Not a field this accepts: extra.')
  })
})
