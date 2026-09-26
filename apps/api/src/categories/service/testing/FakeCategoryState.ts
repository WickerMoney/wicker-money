import type { Category, CategoryRule, CategoryRuleCondition } from '../../../db/models/index.js'
import type { FakeExternalReference } from './FakeExternalReference.js'
import type { FakeTransaction } from './FakeTransaction.js'

/** The whole state the in-memory category and rule repositories operate on. */
export interface FakeCategoryState {
  categories: Category[]
  rules: CategoryRule[]
  conditions: CategoryRuleCondition[]
  transactions: FakeTransaction[]
  externalReferences: FakeExternalReference[]
  /** `limit` of every candidate page requested, in call order. */
  pageLimits: number[]
}
