/** The minimal shape needed to reason about a category's position in the tree. */
export interface CategoryNode {
  readonly id: string
  readonly parent_id: string | null
  readonly name: string
}
