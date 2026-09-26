/** A `core.categories` row, reduced to what naming a budget line needs. */
export interface CategoryRow {
  readonly id: string
  readonly name: string
  readonly parent_id: string | null
}
