/** A saved source mapping as the list endpoint returns it. */
export interface SavedMappingRow {
  /** The mapping's id. */
  readonly id: string
  /** The name the user gave the source. */
  readonly sourceName: string
  /** Header name per mapped field. */
  readonly columns: Record<string, string>
  /** The layout every date in the file uses. */
  readonly dateFormat: string
  /** Whether amounts come from one signed column or from debit and credit columns. */
  readonly amountStyle: string
  /** Whether every sign is flipped after parsing. */
  readonly invertAmount: boolean
}
