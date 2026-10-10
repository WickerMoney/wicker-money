import type { AccountLineRow } from '../repository/AccountLineRow.js'

/** An account line with the user it belongs to, as the in-memory store keeps it. */
export interface StoredAccountLine extends AccountLineRow {
  readonly userId: string
  /** First day after the period, exclusive, `YYYY-MM-DD`. */
  readonly period_end: string
}
