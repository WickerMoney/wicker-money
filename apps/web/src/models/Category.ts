import type { CategoryKind } from './CategoryKind.js'

/** A spending, income or transfer category as returned by `GET /categories`. */
export interface Category {
  /** The category id. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** Stable, URL-safe identifier. Never editable after creation. */
  readonly slug: string
  /** `null` for a top-level category; otherwise the id of its parent. */
  readonly parent_id: string | null
  /** Disabled categories are hidden from pickers but keep their history. */
  readonly is_enabled: boolean
  /** How the category counts toward cash flow. */
  readonly kind: CategoryKind
}
