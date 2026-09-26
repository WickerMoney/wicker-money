/** The fields of an account that decide whether its history can be merged into another. */
export interface MigrationAccount {
  readonly id: string
  readonly name: string
  readonly currency_code: string
}
