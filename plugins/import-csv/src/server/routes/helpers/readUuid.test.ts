import { describe, expect, it } from 'vitest'
import { ImportError } from '../../service/ImportError.js'
import { readUuid } from './readUuid.js'

const ID = '123e4567-e89b-42d3-a456-426614174000'

function failureOf(value: unknown, field: string): ImportError {
  try {
    readUuid(value, field)
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError)
    return error as ImportError
  }
  throw new Error('expected readUuid to throw')
}

describe('readUuid', () => {
  it('returns a UUID unchanged', () => {
    expect(readUuid(ID, 'id')).toBe(ID)
  })

  it.each([undefined, null, 3, '', `{${ID}}`, ID.replaceAll('-', ''), 'not-an-id'])(
    'refuses %s with a 400 on the field',
    (value) => {
      const error = failureOf(value, 'accountId')
      expect(error.statusCode).toBe(400)
      expect(error.code).toBe('import_failed')
      expect(error.issues).toEqual([{ path: ['accountId'], message: 'Choose an account.' }])
    },
  )

  it('words the message for a non-account id generically', () => {
    expect(failureOf('x', 'batch id').issues).toEqual([{ path: ['batch id'], message: 'Must be a valid id.' }])
  })
})
