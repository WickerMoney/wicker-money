import type { LumpSum } from '../models/index.js'

let counter = 0

/** A saved lump sum with sensible defaults; override what a test cares about. */
export function makeLumpSum(over: Partial<LumpSum> = {}): LumpSum {
  counter += 1
  return {
    id: `lump-x${counter}`,
    onDate: '2027-03-15',
    amount: '500.0000',
    note: '',
    allocations: [],
    ...over,
  }
}
