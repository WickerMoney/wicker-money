import type { AccountRow } from './AccountRow.js'

/** Read access to the user's accounts, for naming account lines and checking what they point at. */
export interface AccountRepository {
  /** @returns Every account the user has, archived ones included, since a line outlives archiving. */
  list(): Promise<AccountRow[]>
}
