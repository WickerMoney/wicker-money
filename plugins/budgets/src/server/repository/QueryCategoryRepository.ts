import type { CategoryRepository } from './CategoryRepository.js'
import type { CategoryRow } from './CategoryRow.js'
import type { Query } from '@wickermoney/plugin-sdk/server'

/** {@link CategoryRepository} over a user-bound query runner. */
export class QueryCategoryRepository implements CategoryRepository {
  /** @param q - A query runner already bound to the current user. */
  constructor(private readonly q: Query) {}

  /** @inheritdoc */
  list(): Promise<CategoryRow[]> {
    return this.q<CategoryRow>`SELECT id, name, parent_id FROM core.categories`
  }
}
