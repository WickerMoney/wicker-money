/** One label/value line in the configuration table. */
export interface ConfigRow {
  /** The setting name. */
  readonly label: string
  /** The setting value, formatted for display. */
  readonly value: string
}
