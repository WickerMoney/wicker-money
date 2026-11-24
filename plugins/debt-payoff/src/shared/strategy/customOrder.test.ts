import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildPayoffPlan } from './buildPayoffPlan.js'
import type { DebtInput } from './DebtInput.js'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { STRATEGIES } from './STRATEGIES.js'
import type { PayoffPlan } from './PayoffPlan.js'
import type { Strategy } from './Strategy.js'

const START = '2026-10-10'

/** A small deterministic generator, so the corpus is the same on every run. */
function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

const money = (cents: number): string => (cents / 100).toFixed(2)

/** One generated case: debts that use every optional field the engine reads, an extra and a start date. */
export interface IdentityCase {
  readonly name: string
  readonly debts: readonly DebtInput[]
  readonly extraPayment: string
  readonly startDate: string
}

/**
 * Sixty reproducible cases, from one debt to eight, mixing balances, rates,
 * minimums (some too small to cover interest), earmarks, deferment, promotions
 * with and without deferred interest, and daily compounding.
 */
export function identityCorpus(): IdentityCase[] {
  const rand = lcg(20261121)
  const int = (max: number): number => Math.floor(rand() * max)
  const cases: IdentityCase[] = []
  for (let n = 0; n < 60; n += 1) {
    const count = 1 + (n % 8)
    const debts: DebtInput[] = []
    for (let i = 0; i < count; i += 1) {
      const balance = rand() < 0.08 ? 0 : 5000 + int(2_000_000)
      const minimum = rand() < 0.1 ? 0 : 500 + int(50_000)
      const flavour = int(6)
      debts.push({
        id: `d${n}-${i}`,
        name: `Debt ${i}`,
        balance: money(balance),
        apr: (int(3000) / 100).toFixed(2),
        minimumPayment: money(minimum),
        ...(int(4) === 0 ? { extraPayment: money(int(30_000)) } : {}),
        ...(flavour === 1 ? { repaymentStartsOn: `2027-0${1 + int(9)}-15` } : {}),
        ...(flavour === 2 ? { promoApr: '0', promoEndsOn: `2027-0${1 + int(9)}-28`, promoDeferredInterest: int(2) === 0 } : {}),
        ...(flavour === 3 ? { compounding: int(2) === 0 ? 'daily' : 'daily_simple' } : {}),
      } as DebtInput)
    }
    cases.push({ name: `case ${n}`, debts, extraPayment: money(int(80_000)), startDate: n % 2 === 0 ? '2026-10-10' : '2026-01-31' })
  }
  return cases
}

/** The SHA-256 of the plan's JSON for a case and strategy: what "byte-identical" is measured by. */
export function planDigest(c: IdentityCase, strategy: Strategy): string {
  const plan = buildPayoffPlan(c.debts, { strategy, extraPayment: c.extraPayment, startDate: c.startDate })
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex')
}

const debt = (id: string, balance: string, apr: string, minimumPayment: string, name = id): DebtInput => ({
  id, name, balance, apr, minimumPayment,
})

const plan = (debts: readonly DebtInput[], strategy: Strategy, extraPayment = '300'): PayoffPlan =>
  buildPayoffPlan(debts, { strategy, extraPayment, startDate: START })

// The same three debts the snowball and avalanche tests use.
const big = debt('a', '5000', '24', '150', 'Big card')
const small = debt('b', '1200', '8', '50', 'Small card')
const loan = debt('c', '8000', '6', '200', 'Loan')

describe('custom order', () => {
  it('is one of the strategies, beside the existing two', () => {
    expect(STRATEGIES).toEqual(['snowball', 'avalanche', 'custom'])
  })

  it('aims the extra at the debts in the order they are listed', () => {
    const p = plan([loan, small, big], 'custom')
    expect(p.strategy).toBe('custom')
    expect(p.order).toEqual(['c', 'b', 'a'])
    expect(p.debts.map((d) => d.id)).toEqual(['c', 'b', 'a'])
  })

  it('differs from snowball and avalanche when the person orders it differently', () => {
    const custom = plan([loan, small, big], 'custom')
    const snowball = plan([loan, small, big], 'snowball')
    const avalanche = plan([loan, small, big], 'avalanche')
    expect(snowball.order).toEqual(['b', 'a', 'c'])
    expect(avalanche.order).toEqual(['a', 'b', 'c'])
    expect(custom.debtFreeDate).not.toBe(avalanche.debtFreeDate)
    expect(BigInt(custom.totalInterest.replace('.', ''))).toBeGreaterThan(BigInt(avalanche.totalInterest.replace('.', '')))
  })

  it('gives the same plan as avalanche when the list is already in avalanche order', () => {
    const custom = plan([big, small, loan], 'custom')
    const avalanche = plan([big, small, loan], 'avalanche')
    expect({ ...custom, strategy: 'x' }).toEqual({ ...avalanche, strategy: 'x' })
  })

  it('gives the same plan as snowball when the list is already in snowball order', () => {
    const custom = plan([small, big, loan], 'custom')
    const snowball = plan([small, big, loan], 'snowball')
    expect({ ...custom, strategy: 'x' }).toEqual({ ...snowball, strategy: 'x' })
  })

  it('pays the whole extra to the first listed debt until it is cleared, then rolls on', () => {
    const p = plan([loan, small, big], 'custom', '300')
    // 200 minimum + 300 extra on the loan, the others at their minimums.
    expect(p.schedule[0]?.debts.find((d) => d.debtId === 'c')?.payment).toBe('500.0000')
    expect(p.schedule[0]?.debts.find((d) => d.debtId === 'b')?.payment).toBe('50.0000')
    const loanDone = p.debts.find((d) => d.id === 'c')?.payoffMonth ?? 0
    const smallDone = p.debts.find((d) => d.id === 'b')?.payoffMonth ?? 0
    expect(loanDone).toBeGreaterThan(0)
    expect(loanDone).toBeLessThanOrEqual(smallDone)
  })

  it('skips a debt that is already cleared, and a cleared one has no place in line', () => {
    const cleared = debt('z', '0', '20', '25')
    const p = plan([cleared, loan, small], 'custom')
    expect(p.order).toEqual(['c', 'b'])
    expect(p.debts.map((d) => d.id)).toEqual(['c', 'b', 'z'])
    expect(p.debts.find((d) => d.id === 'z')).toMatchObject({ payoffMonth: 0, totalPaid: '0.0000' })
  })

  it('moves the extra to the next listed debt when the first has no balance to take it', () => {
    const p = plan([debt('z', '0', '20', '25'), small, big], 'custom', '100')
    expect(p.schedule[0]?.debts.find((d) => d.debtId === 'b')?.payment).toBe('150.0000')
  })

  it('follows the order given, so moving a debt changes the plan and the order it came in does not matter otherwise', () => {
    const one = plan([small, loan, big], 'custom')
    const two = plan([big, loan, small], 'custom')
    expect(one.order).toEqual(['b', 'c', 'a'])
    expect(two.order).toEqual(['a', 'c', 'b'])
    expect(one.totalInterest).not.toBe(two.totalInterest)
  })

  it('does not modify its input and is the same every time', () => {
    const debts = [loan, small, big]
    const copy = structuredClone(debts)
    const first = JSON.stringify(plan(debts, 'custom'))
    expect(debts).toEqual(copy)
    expect(JSON.stringify(plan(debts, 'custom'))).toBe(first)
  })

  it('works for one debt, and for none', () => {
    expect(plan([big], 'custom').order).toEqual(['a'])
    expect(plan([], 'custom')).toMatchObject({ order: [], months: 0, debtFreeDate: START })
  })

  it('still refuses a strategy it does not know', () => {
    expect(() => plan([big], 'whatever' as Strategy)).toThrow(/Unknown strategy/)
  })
})

describe('the existing strategies are unchanged', () => {
  /**
   * `identityDigests.json` holds the SHA-256 of the JSON of every plan the
   * corpus builds for snowball and avalanche, produced by the engine as it
   * stood before Custom order was added (origin/main 3ed89b6). A plan is built
   * from the debts, the strategy, the extra and the date alone, so a person who
   * never picks Custom order gets exactly the bytes they got before.
   */
  const expected = JSON.parse(readFileSync(join(import.meta.dirname, 'identityDigests.json'), 'utf8')) as Record<string, string>
  const corpus = identityCorpus()

  it('has a digest for every case and strategy', () => {
    expect(Object.keys(expected)).toHaveLength(corpus.length * 2)
  })

  it.each(['snowball', 'avalanche'] as const)('builds byte-identical %s plans for %i cases', (strategy) => {
    const mismatches = corpus
      .filter((c) => planDigest(c, strategy) !== expected[`${c.name} ${strategy}`])
      .map((c) => c.name)
    expect(mismatches).toEqual([])
  })

  it('is not an empty check: the corpus has deferment, promotions, earmarks and capped plans', () => {
    const debts = corpus.flatMap((c) => c.debts)
    expect(debts.some((d) => d.repaymentStartsOn !== undefined)).toBe(true)
    expect(debts.some((d) => d.promoApr !== undefined && d.promoDeferredInterest === true)).toBe(true)
    expect(debts.some((d) => d.extraPayment !== undefined)).toBe(true)
    expect(debts.some((d) => d.compounding === 'daily')).toBe(true)
    expect(new Set(Object.values(expected)).size).toBeGreaterThan(100)
  })
})
