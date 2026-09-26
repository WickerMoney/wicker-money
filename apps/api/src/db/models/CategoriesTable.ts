import type { Generated, Selectable } from 'kysely'
import type { TimestampWithDefault } from './columns.js'
import type { CategoryKind } from './CategoryKind.js'

/** A spending, income or transfer category. Categories nest one level: a child names its parent. */
export interface CategoriesTable {
  id: Generated<string>
  user_id: string
  name: string
  slug: string
  parent_id: string | null
  icon: string | null
  is_system: Generated<boolean>
  is_enabled: Generated<boolean>
  /** What this category means for cash flow. Transfers count as neither. */
  kind: Generated<CategoryKind>
  sort_order: Generated<number>
  created_at: TimestampWithDefault
  updated_at: TimestampWithDefault
}

export type Category = Selectable<CategoriesTable>
