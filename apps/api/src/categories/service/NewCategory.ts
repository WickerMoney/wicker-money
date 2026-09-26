import type { CategoryKind } from '../../db/models/index.js'

/** A category to create. */
export interface NewCategory {
  readonly name: string
  /** Lowercase kebab-case identifier, unique per user. */
  readonly slug: string
  readonly parentId?: string | null | undefined
  readonly icon?: string | null | undefined
  readonly sortOrder: number
  readonly kind: CategoryKind
}
