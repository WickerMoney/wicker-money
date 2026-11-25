import { createHash } from 'node:crypto'
import { buildPayoffPlan } from './buildPayoffPlan.js'
import type { DebtInput } from './DebtInput.js'
import type { Strategy } from './Strategy.js'

/**
 * @module
 * The generated corpus the "plans are unchanged" tests hash. It lives in its
 * own file so more than one test file can use it without registering the
 * other's tests.
 */

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
