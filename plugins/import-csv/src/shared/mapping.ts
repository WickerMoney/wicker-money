import { parseCsv } from './csv.js'
import type { AmountStyle, DateFormat } from './fields.js'
import { mapParsedRows } from './mapParsedRows.js'

/**
 * Which CSV column feeds which ledger field.
 *
 * Header names rather than indexes: a bank that adds a column between exports
 * would silently shift every index, and this mapping is saved and reused for
 * months. Names survive that; positions do not.
 */
export interface ColumnMap {
  /** Header of the column holding the transaction date. */
  readonly date: string
  /** Header of the column holding the merchant or description. */
  readonly merchant: string
  /** Header of the signed amount column; used when amountStyle is 'signed'. */
  readonly amount?: string
  /** Header of the money-out column; used when amountStyle is 'debit-credit'. */
  readonly debit?: string
  /** Header of the money-in column; used when amountStyle is 'debit-credit'. */
  readonly credit?: string
  /** Header of the free-text notes column, if the source has one. */
  readonly notes?: string
  /** The source's own transaction id, when it has one. It is the most reliable key for detecting duplicates. */
  readonly externalId?: string
}

/** A saved description of how one source's CSV maps onto ledger fields. */
export interface SourceMapping {
  /** The name the user gave this source, unique per user ignoring case. */
  readonly sourceName: string
  /** Which column feeds which field. */
  readonly columns: ColumnMap
  /** The layout every date in the file uses. */
  readonly dateFormat: DateFormat
  /** Whether amounts come from one signed column or from debit and credit columns. */
  readonly amountStyle: AmountStyle
  /**
   * Flips every sign after parsing.
   *
   * Some exports report spending as positive because the statement is written
   * from the bank's point of view. The ledger's convention is that money
   * leaving an account is negative, and this is where a source is reconciled
   * to it — once, visibly, rather than per row.
   */
  readonly invertAmount: boolean
}

/** A row ready to become a transaction, or the reason it cannot. */
export interface MappedRow {
  /** 1-based position in the file counting the header, so the first data row is 2. */
  readonly rowNumber: number
  /** ISO `YYYY-MM-DD` date. */
  readonly date: string
  /** Merchant or description, trimmed and capped at 300 characters. */
  readonly merchant: string
  /** Signed decimal string; negative means money leaving the account. */
  readonly amount: string
  /** Trimmed notes capped at 1000 characters, or `null` when blank. */
  readonly notes: string | null
  /** The source's own transaction id capped at 255 characters, or `null` when absent. */
  readonly externalId: string | null
  /** The original cells of the row. */
  readonly raw: readonly string[]
}

/** A row that could not be mapped, with the field at fault and why. */
export interface RowError {
  /** 1-based position in the file counting the header, so the first data row is 2. */
  readonly rowNumber: number
  /** The ledger field that failed: `date`, `merchant` or `amount`. */
  readonly field: string
  /** A human-readable explanation of the failure. */
  readonly reason: string
  /** The original cells of the row. */
  readonly raw: readonly string[]
}

/** The outcome of mapping a whole file: the rows that worked and the ones that did not. */
export interface MapResult {
  /** Rows that mapped cleanly, in file order. */
  readonly rows: readonly MappedRow[]
  /** Rows that failed, in file order. */
  readonly errors: readonly RowError[]
}

/**
 * Suggests a mapping from header names.
 *
 * A convenience for the first run only — every suggestion lands in a dropdown
 * the user confirms. Nothing here is applied without being shown, which is why
 * heuristics are acceptable for columns and not for dates.
 *
 * @param headers - The CSV's header names.
 * @returns The header that best matches each field; a field with no plausible
 *   match is left undefined.
 */
export function suggestColumns(headers: readonly string[]): Partial<ColumnMap> {
  const find = (...patterns: RegExp[]): string | undefined =>
    headers.find((h) => patterns.some((p) => p.test(h.toLowerCase())))

  return {
    date: find(/^(transaction|posted|posting|value)?\s*date$/, /date/),
    merchant: find(/description/, /merchant/, /payee/, /name/, /details?/),
    amount: find(/^amount$/, /amount/),
    debit: find(/debit/, /withdrawal/, /money out/),
    credit: find(/credit/, /deposit/, /money in/),
    notes: find(/^(notes?|memo|reference)$/),
    externalId: find(/transaction id/, /^id$/, /reference number/, /^fit_?id$/),
  }
}

/**
 * Picks the amount style implied by which columns a source actually has.
 *
 * @param headers - The CSV's header names.
 * @returns `debit-credit` when there is a debit or credit column but no amount
 *   column, otherwise `signed`.
 */
export function suggestAmountStyle(headers: readonly string[]): AmountStyle {
  const s = suggestColumns(headers)
  return s.amount === undefined && (s.debit !== undefined || s.credit !== undefined)
    ? 'debit-credit'
    : 'signed'
}

/**
 * Applies a mapping to parsed CSV text.
 *
 * Rows that cannot be mapped are collected rather than thrown: one unparseable
 * row in eight hundred should be reported, not abort the import, and the caller
 * shows the list before anything is written.
 *
 * Merchant, notes and external id are truncated to 300, 1000 and 255
 * characters respectively. Row numbers are 1-based and count the header, so
 * the first data row is 2.
 *
 * @param text - The CSV text.
 * @param mapping - How to read it.
 * @returns The mapped rows and the per-row errors.
 */
export function mapRows(text: string, mapping: SourceMapping): MapResult {
  return mapParsedRows(parseCsv(text), mapping)
}
