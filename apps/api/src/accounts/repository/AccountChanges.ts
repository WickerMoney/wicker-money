import type { AccountType } from '../../db/models/index.js'

/** Fields of an account that can be edited; omitted fields are left untouched. */
export interface AccountChanges {
  readonly name?: string | undefined
  readonly accountType?: AccountType | undefined
  readonly currencyCode?: string | undefined
  readonly bufferAmount?: string | undefined
  readonly spendable?: boolean | undefined
}
