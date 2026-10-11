import { describe, expect, it } from 'vitest'
import { ImportError } from '../../service/ImportError.js'
import { readAnalyzePage } from './readAnalyzePage.js'

function failureOf(body: unknown): ImportError {
  try {
    readAnalyzePage(body)
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError)
    return error as ImportError
  }
  throw new Error('expected readAnalyzePage to throw')
}

describe('readAnalyzePage', () => {
  it('defaults to the first 500 flagged rows, also for a body from before paging existed', () => {
    expect(readAnalyzePage({})).toEqual({ offset: 0, limit: 500 })
    expect(readAnalyzePage(undefined)).toEqual({ offset: 0, limit: 500 })
    expect(readAnalyzePage({ flaggedOffset: null, flaggedLimit: null })).toEqual({ offset: 0, limit: 500 })
  })

  it('reads an offset and a limit', () => {
    expect(readAnalyzePage({ flaggedOffset: 1500, flaggedLimit: 250 })).toEqual({ offset: 1500, limit: 250 })
    expect(readAnalyzePage({ flaggedOffset: 0, flaggedLimit: 1 })).toEqual({ offset: 0, limit: 1 })
  })

  it('lowers a limit above 1000 to 1000 instead of refusing it', () => {
    expect(readAnalyzePage({ flaggedLimit: 1000 }).limit).toBe(1000)
    expect(readAnalyzePage({ flaggedLimit: 50_000 }).limit).toBe(1000)
  })

  it.each([-1, 1.5, '10', true, [], NaN])('refuses flaggedOffset %j on that field', (value) => {
    const error = failureOf({ flaggedOffset: value })
    expect(error.statusCode).toBe(400)
    expect(error.issues).toEqual([{ path: ['flaggedOffset'], message: 'Must be a whole number, 0 or more.' }])
  })

  it.each([0, -3, 2.5, '5', false])('refuses flaggedLimit %j on that field', (value) => {
    expect(failureOf({ flaggedLimit: value }).issues).toEqual([
      { path: ['flaggedLimit'], message: 'Must be a whole number, 1 or more.' },
    ])
  })
})
