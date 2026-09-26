import { describe, expect, it } from 'vitest'
import { encodeTransactionCursor } from './encodeTransactionCursor.js'
import { listTransactionsQuery } from './listTransactionsQuery.js'
import { transactionCursor } from './transactionCursor.js'

const ID = '0b0e7d0e-7b1a-4c6e-9d59-7a3f2f1d6c11'
const wire = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')

describe('transactionCursor', () => {
  it.each([
    { sort: 'date', direction: 'desc', value: '2026-03-02', id: ID },
    { sort: 'amount', direction: 'asc', value: '-12.5000', id: ID },
    { sort: 'merchant', direction: 'desc', value: 'Café "Ünï" 100%', id: ID },
    { sort: 'merchant', direction: 'asc', value: '', id: ID },
  ] as const)('round-trips %j', (cursor) => {
    expect(transactionCursor.parse(encodeTransactionCursor(cursor))).toEqual(cursor)
  })

  it('produces URL-safe text', () => {
    const encoded = encodeTransactionCursor({ sort: 'merchant', direction: 'asc', value: '??>>~~', id: ID })

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it.each([
    ['not base64url', 'a b+/='],
    ['not JSON', Buffer.from('nope').toString('base64url')],
    ['JSON null', wire(null)],
    ['a JSON array', wire([])],
    ['a JSON string', wire('date')],
    ['an empty string', ''],
    ['an unknown sort', wire({ sort: 'notes', direction: 'asc', value: 'x', id: ID })],
    ['an unknown direction', wire({ sort: 'date', direction: 'up', value: '2026-01-01', id: ID })],
    ['a missing id', wire({ sort: 'date', direction: 'asc', value: '2026-01-01' })],
    ['an id that is not a uuid', wire({ sort: 'date', direction: 'asc', value: '2026-01-01', id: '1 OR 1=1' })],
    ['an extra field', wire({ sort: 'date', direction: 'asc', value: '2026-01-01', id: ID, extra: 1 })],
    ['a date that does not exist', wire({ sort: 'date', direction: 'asc', value: '2026-02-31', id: ID })],
    ['text where a date is expected', wire({ sort: 'date', direction: 'asc', value: 'yesterday', id: ID })],
    ['a non-numeric amount', wire({ sort: 'amount', direction: 'asc', value: '1e5', id: ID })],
    ['a number instead of a string', wire({ sort: 'amount', direction: 'asc', value: 5, id: ID })],
    ['a NUL in a merchant', wire({ sort: 'merchant', direction: 'asc', value: 'a\0b', id: ID })],
    ['an over-long merchant', wire({ sort: 'merchant', direction: 'asc', value: 'm'.repeat(301), id: ID })],
    ['an over-long cursor', 'A'.repeat(1025)],
  ])('rejects %s', (_what, raw) => {
    expect(transactionCursor.safeParse(raw).success).toBe(false)
  })
})

describe('listTransactionsQuery', () => {
  it('leaves the cursor out for a first page and does not count by default', () => {
    const parsed = listTransactionsQuery.parse({})

    expect(parsed.cursor).toBeUndefined()
    expect(parsed.withTotal).toBe('false')
  })

  it('reports a malformed cursor as a query error naming the field', () => {
    const result = listTransactionsQuery.safeParse({ cursor: 'garbage!' })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['cursor'])
  })

  it('no longer knows an offset', () => {
    expect(listTransactionsQuery.parse({ offset: '5' })).not.toHaveProperty('offset')
  })
})
