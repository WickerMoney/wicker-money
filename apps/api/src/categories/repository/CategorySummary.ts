/** A category reduced to what starter-set maintenance needs. */
export interface CategorySummary {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly parent_id: string | null
}
