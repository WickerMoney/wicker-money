import type { MigrationAccount } from '../repository/MigrationAccount.js'

/** The two accounts of a migration. */
export interface MigrationPair {
  /** The account whose history would be moved. */
  readonly from: MigrationAccount
  /** The account that would receive it. */
  readonly to: MigrationAccount
}
