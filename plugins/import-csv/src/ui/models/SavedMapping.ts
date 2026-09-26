import type { AmountStyle, ColumnMap, DateFormat } from '../../shared/index.js'

/** A column mapping remembered from an earlier successful import. */
export interface SavedMapping {
  /** The name the user gave the source, such as "Chase Checking". */
  readonly sourceName: string
  readonly columns: ColumnMap
  readonly dateFormat: DateFormat
  readonly amountStyle: AmountStyle
  /** `true` when the file shows spending as a positive number. */
  readonly invertAmount: boolean
}
