import { describe, expect, it } from 'vitest'
import { ImportError } from '../../service/ImportError.js'
import { MAX_CSV_BYTES } from './MAX_CSV_BYTES.js'
import { readCsv } from './readCsv.js'
import { readAnalyzeRequest } from './readAnalyzeRequest.js'
import { readCommitRequest } from './readCommitRequest.js'

function messageOf(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError)
    expect((error as ImportError).statusCode).toBe(400)
    return (error as ImportError).message
  }
  throw new Error('expected a failure')
}

describe('readCsv', () => {
  it('returns the text unmodified', () => {
    expect(readCsv({ csv: 'a,b\n1,2\n' })).toBe('a,b\n1,2\n')
  })

  it('refuses a missing csv', () => {
    expect(messageOf(() => readCsv({}))).toBe('csv: Choose a file with at least one row.')
  })

  it('refuses a csv that is not a string', () => {
    expect(messageOf(() => readCsv({ csv: 42 }))).toBe('csv: Choose a file with at least one row.')
    expect(messageOf(() => readCsv({ csv: ['a'] }))).toBe('csv: Choose a file with at least one row.')
  })

  it('refuses blank text', () => {
    expect(messageOf(() => readCsv({ csv: '  \n\t ' }))).toBe('csv: Choose a file with at least one row.')
  })

  it('accepts a file exactly at the limit', () => {
    expect(readCsv({ csv: 'a'.repeat(MAX_CSV_BYTES) })).toHaveLength(MAX_CSV_BYTES)
  })

  it('refuses a file one byte over the limit, saying 8 MB', () => {
    expect(messageOf(() => readCsv({ csv: 'a'.repeat(MAX_CSV_BYTES + 1) }))).toContain('8 MB')
  })

  it('measures bytes, not characters, so multi-byte text cannot slip past the advertised limit', () => {
    // 2 bytes per character: under the limit as characters, over it as bytes.
    const csv = 'é'.repeat(Math.ceil(MAX_CSV_BYTES / 2) + 1)
    expect(csv.length).toBeLessThan(MAX_CSV_BYTES)
    expect(messageOf(() => readCsv({ csv }))).toContain('8 MB')
  })
})

describe('request readers', () => {
  const mapping = {
    sourceName: 'Bank',
    columns: { date: 'Date', merchant: 'Description', amount: 'Amount' },
    dateFormat: 'YYYY-MM-DD',
  }
  const accountId = '5b0b8a0e-8d0b-4f0e-9d0e-0a8d0b4f0e9d'

  it('treats a missing body as a validation error, not a crash', () => {
    expect(messageOf(() => readAnalyzeRequest(undefined))).toBe('accountId: Choose an account.')
    expect(messageOf(() => readCommitRequest(null))).toBe('accountId: Choose an account.')
  })

  it('defaults the commit file name and accepted rows', () => {
    const request = readCommitRequest({ accountId, csv: 'Date\n1', ...mapping })
    expect(request.fileName).toBe('upload.csv')
    expect(request.acceptRowNumbers).toEqual([])
  })

  it('keeps only numeric accepted row numbers and truncates the file name', () => {
    const request = readCommitRequest({
      accountId, csv: 'Date\n1', ...mapping, fileName: 'x'.repeat(400), acceptRowNumbers: [2, 'a', 5, null],
    })
    expect(request.fileName).toHaveLength(300)
    expect(request.acceptRowNumbers).toEqual([2, 5])
  })

  it('carries a valid idempotency key and omits it when none is sent', () => {
    const base = { accountId, csv: 'Date\n1', ...mapping }
    expect(readCommitRequest({ ...base, idempotencyKey: 'abc-123' }).idempotencyKey).toBe('abc-123')
    expect(readCommitRequest({ ...base, idempotencyKey: 'x'.repeat(128) }).idempotencyKey).toHaveLength(128)
    expect(readCommitRequest(base)).not.toHaveProperty('idempotencyKey')
    expect(readCommitRequest({ ...base, idempotencyKey: null })).not.toHaveProperty('idempotencyKey')
  })

  it('refuses an idempotency key that is empty, too long or not a string', () => {
    const base = { accountId, csv: 'Date\n1', ...mapping }
    const expected = 'idempotencyKey must be a string of 1 to 128 characters.'
    expect(messageOf(() => readCommitRequest({ ...base, idempotencyKey: '' }))).toBe(expected)
    expect(messageOf(() => readCommitRequest({ ...base, idempotencyKey: 'x'.repeat(129) }))).toBe(expected)
    expect(messageOf(() => readCommitRequest({ ...base, idempotencyKey: 42 }))).toBe(expected)
  })
})
