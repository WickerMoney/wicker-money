import type { Generated, Selectable } from 'kysely'
import type { TimestampWithDefault } from './columns.js'

/** A categorization rule: when every one of its conditions matches a transaction, the transaction is filed under `category_id`. */
export interface CategoryRulesTable {
  id: Generated<string>
  user_id: string
  category_id: string
  priority: Generated<number>
  created_at: TimestampWithDefault
  updated_at: TimestampWithDefault
}

export type CategoryRule = Selectable<CategoryRulesTable>
