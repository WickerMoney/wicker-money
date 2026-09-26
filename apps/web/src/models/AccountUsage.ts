/** What still references an account, as returned by `GET /accounts/:id/usage`. */
export interface AccountUsage {
  /** Total number of rows that reference the account. */
  readonly total: number
  /** The same total broken down per referencing table. */
  readonly by: readonly { readonly table: string; readonly count: number }[]
  /** Tables that hold references the connection is not permitted to read. */
  readonly unreadable: readonly string[]
}
