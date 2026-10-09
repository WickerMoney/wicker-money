import { describe, expect, it } from 'vitest'
import { BudgetError } from '../../service/BudgetError.js'
import { requireUuid } from './requireUuid.js'
import { requireWindowId } from './requireWindowId.js'

const ID = '123e4567-e89b-42d3-a456-426614174000'

describe('requireUuid', () => {
  it('returns a UUID unchanged', () => {
    expect(requireUuid(ID, 'categoryId')).toBe(ID)
  })

  it.each([undefined, null, 5, '', '{' + ID + '}', 'not-an-id'])('refuses %s with a 400 on the field', (value) => {
    expect.assertions(4)
    try {
      requireUuid(value, 'categoryId')
    } catch (error) {
      expect(error).toBeInstanceOf(BudgetError)
      expect((error as BudgetError).statusCode).toBe(400)
      expect((error as BudgetError).code).toBe('bad_category')
      expect((error as BudgetError).issues).toEqual([{ path: ['categoryId'], message: 'Choose a category.' }])
    }
  })
})

describe('requireWindowId', () => {
  it('returns a UUID unchanged', () => {
    expect(requireWindowId(ID)).toBe(ID)
  })

  it.each([undefined, 7, '', ID.replaceAll('-', '')])('refuses %s with 400 bad_id', (value) => {
    expect(() => requireWindowId(value)).toThrow(expect.objectContaining({ statusCode: 400, code: 'bad_id' }))
  })
})
