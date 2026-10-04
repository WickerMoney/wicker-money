import { describe, expect, it } from 'vitest'
import { transactionMatchesQuery } from './transactionMatchesQuery.js'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('transactionMatchesQuery', () => {
  it('splits a comma-separated list and ignores blanks and spaces', () => {
    expect(transactionMatchesQuery.parse({ transactionIds: ` ${id(1)}, ,${id(2)},` }))
      .toEqual({ transactionIds: [id(1), id(2)] })
  })

  it('refuses an empty list, a non-UUID and more than a page', () => {
    expect(transactionMatchesQuery.safeParse({ transactionIds: '' }).success).toBe(false)
    expect(transactionMatchesQuery.safeParse({}).success).toBe(false)
    expect(transactionMatchesQuery.safeParse({ transactionIds: `${id(1)},nope` }).success).toBe(false)
    const many = Array.from({ length: 201 }, (_, i) => id(i)).join(',')
    expect(transactionMatchesQuery.safeParse({ transactionIds: many }).success).toBe(false)
    const page = Array.from({ length: 200 }, (_, i) => id(i)).join(',')
    expect(transactionMatchesQuery.safeParse({ transactionIds: page }).success).toBe(true)
  })
})
