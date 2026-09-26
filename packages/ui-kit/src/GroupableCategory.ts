/**
 * The least a component needs to know about a category in order to group it.
 * Any wider row also fits.
 */
export interface GroupableCategory {
  /** The category id. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** The parent's id, or `null` for a top-level category. */
  readonly parent_id: string | null
}
