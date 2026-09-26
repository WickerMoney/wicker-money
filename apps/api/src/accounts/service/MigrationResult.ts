import type { MigrationPlan } from './MigrationPlan.js'

/** The outcome of a committed migration: the plan that was carried out plus where the history went. */
export interface MigrationResult extends MigrationPlan {
  /** Name of the account that received the history. */
  readonly mergedInto: string
}
