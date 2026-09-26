import type { FakeCategoryState } from './FakeCategoryState.js'

/** @returns A fresh, empty {@link FakeCategoryState}. */
export function emptyCategoryState(): FakeCategoryState {
  return { categories: [], rules: [], conditions: [], transactions: [], externalReferences: [], pageLimits: [] }
}
