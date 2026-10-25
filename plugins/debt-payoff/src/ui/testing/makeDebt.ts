import type { Debt } from '../models/index.js'

let counter = 0

/** A saved debt with sensible defaults; override what a test cares about. */
export function makeDebt(over: Partial<Debt> = {}): Debt {
  counter += 1
  return {
    id: `debt-${counter}`,
    name: `Debt ${counter}`,
    balance: '1000.0000',
    apr: '12.0000',
    minimumPayment: '100.0000',
    accountId: null,
    sortOrder: counter,
    archived: false,
    included: true,
    extraPayment: '0.0000',
    ...over,
  }
}
