import type { AccountType } from '../../db/models/index.js'

/** What validating a leg needs to know about its account. */
export interface LegAccount {
  readonly id: string
  readonly account_type: AccountType
  readonly archived: boolean
}
