/** How many accounts and categories a snapshot names that no longer exist. */
export interface UndoMissingReferences {
  /** Accounts (including a transfer's counterpart accounts) that are gone. */
  readonly accounts: number
  /** Categories, on the transactions or their splits, that are gone. */
  readonly categories: number
}
