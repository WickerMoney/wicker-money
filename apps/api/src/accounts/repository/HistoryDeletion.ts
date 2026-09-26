/** How many rows a history deletion removed. */
export interface HistoryDeletion {
  readonly transactions: number
  readonly recurringItems: number
}
