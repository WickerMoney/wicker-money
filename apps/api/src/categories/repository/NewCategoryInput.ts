import type { CategoryKind } from '../../db/models/index.js'

/** Fields required to create a category. The owner is taken from the current user. */
export interface NewCategoryInput {
  readonly userId: string
  readonly name: string
  readonly slug: string
  readonly parentId: string | null
  readonly icon: string | null
  readonly sortOrder: number
  readonly kind: CategoryKind
}
