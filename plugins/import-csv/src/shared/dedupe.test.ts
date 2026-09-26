import { describe, expect, it } from 'vitest'
import { classifyRows, normalizeMoney, sameMoney, type ClassifiedRow, type ExistingTransaction } from './dedupe.js'
import type { MappedRow } from './mapping.js'

/** Small deterministic PRNG so a failing random case can be reproduced. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The quadratic algorithm the indexed one replaced, kept as the specification. */
function naiveClassify(rows: readonly MappedRow[], existing: readonly ExistingTransaction[]): ClassifiedRow[] {
  const daysApart = (a: string, b: string): number =>
    Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000
  const sameMerchant = (a: string, b: string): boolean => {
    const norm = (s: string): string =>
      s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
    const x = norm(a)
    const y = norm(b)
    if (x === y) return true
    const shorter = x.length <= y.length ? x : y
    const longer = x.length <= y.length ? y : x
    return shorter.length >= 6 && longer.startsWith(shorter)
  }

  const byExternalId = new Map<string, ExistingTransaction>()
  for (const t of existing) {
    if (t.externalId !== null && t.externalId !== '') byExternalId.set(t.externalId, t)
  }
  const seen = new Set<string>()
  return rows.map((row): ClassifiedRow => {
    if (row.externalId !== null) {
      const hit = byExternalId.get(row.externalId)
      if (hit !== undefined) {
        return { row, status: 'duplicate', matched: hit, reason: `already imported (id ${row.externalId})` }
      }
      if (seen.has(row.externalId)) {
        return { row, status: 'duplicate', matched: null, reason: `repeated id ${row.externalId} within this file` }
      }
      seen.add(row.externalId)
      return { row, status: 'new', matched: null, reason: null }
    }
    const candidate = existing.find(
      (t) =>
        sameMoney(t.amount, row.amount) &&
        daysApart(t.date, row.date) <= 1 &&
        sameMerchant(t.merchant, row.merchant),
    )
    if (candidate !== undefined) {
      return {
        row,
        status: 'needs-review',
        matched: candidate,
        reason: `looks like ${candidate.merchant} on ${candidate.date} for ${normalizeMoney(candidate.amount)}`,
      }
    }
    return { row, status: 'new', matched: null, reason: null }
  })
}

const MERCHANTS = [
  'AMAZON MKTPL', 'Amazon Mktpl 4XJ22', 'COFFEE BAR', 'coffee bar #12', 'GROCERY WORLD',
  'Grocery World, Main St', 'SHELL', 'Shell Oil', 'PAYCHECK', 'Rent', 'NETFLIX.COM', 'netflix com',
]

function isoDay(base: number, offset: number): string {
  return new Date((base + offset) * 86_400_000).toISOString().slice(0, 10)
}

function generate(seed: number, rowCount: number, existingCount: number, dayRange: number, amountPool: number) {
  const rand = mulberry32(seed)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!
  const base = Math.floor(Date.parse('2026-01-01T00:00:00Z') / 86_400_000)
  const amount = (padded: boolean): string => {
    const cents = Math.floor(rand() * amountPool)
    const text = `${cents % 2 === 0 ? '-' : ''}${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
    return padded ? `${text}00` : text
  }

  const existing: ExistingTransaction[] = Array.from({ length: existingCount }, (_, i) => ({
    id: `e${i}`,
    date: isoDay(base, Math.floor(rand() * dayRange)),
    merchant: pick(MERCHANTS),
    amount: amount(true),
    externalId: rand() < 0.3 ? `ext-${Math.floor(rand() * existingCount)}` : rand() < 0.05 ? '' : null,
  }))
  const rows: MappedRow[] = Array.from({ length: rowCount }, (_, i) => ({
    rowNumber: i + 2,
    date: isoDay(base, Math.floor(rand() * dayRange)),
    merchant: pick(MERCHANTS),
    amount: amount(false),
    notes: null,
    externalId: rand() < 0.3 ? `ext-${Math.floor(rand() * existingCount * 1.2)}` : null,
    raw: [],
  }))
  return { rows, existing }
}

describe('indexed duplicate detection matches the linear scan it replaced', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`gives identical verdicts on random data (seed ${seed})`, () => {
      // A small amount pool and a short date range force plenty of collisions,
      // so every branch (id hit, repeated id, heuristic hit, new) is exercised.
      const { rows, existing } = generate(seed, 400, 600, 12, 300)
      const fast = classifyRows(rows, existing)
      expect(fast).toEqual(naiveClassify(rows, existing))
      const statuses = new Set(fast.map((c) => c.status))
      expect(statuses).toEqual(new Set(['new', 'duplicate', 'needs-review']))
    })
  }

  it('returns the earliest matching transaction when several qualify', () => {
    const existing: ExistingTransaction[] = [
      { id: 'late', date: '2026-03-05', merchant: 'COFFEE BAR', amount: '-4.5000', externalId: null },
      { id: 'early', date: '2026-03-03', merchant: 'coffee bar', amount: '-4.50', externalId: null },
    ]
    const row: MappedRow = {
      rowNumber: 2, date: '2026-03-04', merchant: 'Coffee Bar', amount: '-4.5', notes: null, externalId: null, raw: [],
    }
    expect(classifyRows([row], existing)[0]?.matched?.id).toBe('late')
    expect(classifyRows([row], existing)).toEqual(naiveClassify([row], existing))
  })

  it('never matches a transaction whose date does not parse', () => {
    const existing: ExistingTransaction[] = [
      { id: 'bad', date: 'not-a-date', merchant: 'COFFEE BAR', amount: '-4.50', externalId: null },
    ]
    const row: MappedRow = {
      rowNumber: 2, date: '2026-03-04', merchant: 'COFFEE BAR', amount: '-4.50', notes: null, externalId: null, raw: [],
    }
    expect(classifyRows([row], existing)[0]?.status).toBe('new')
    expect(classifyRows([row], existing)).toEqual(naiveClassify([row], existing))
  })
})

describe('duplicate detection performance', () => {
  it('classifies 2,000 rows against 20,000 existing transactions in well under 1.5 s', () => {
    const { rows, existing } = generate(42, 2_000, 20_000, 60, 50_000)
    const started = performance.now()
    const result = classifyRows(rows, existing)
    const elapsed = performance.now() - started

    expect(result).toHaveLength(2_000)
    // The linear scan took about 25 s on this shape of input.
    expect(elapsed).toBeLessThan(1_500)
  })
})
