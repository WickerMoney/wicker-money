import type { ReferenceUsage } from '../usage.js'

/** Discovery of what references a row, across every schema including plugins'. */
export interface UsageRepository {
  /**
   * Counts rows that reference one parent row through a foreign key.
   *
   * @param parentTable - Referenced table, schema-qualified (for example `core.categories`).
   * @param columnPattern - SQL `LIKE` pattern for the referencing column name (for example `%category_id`).
   * @param id - The parent row's id.
   * @returns Total references with a per-table breakdown, plus tables that could not be read.
   */
  summarize(parentTable: string, columnPattern: string, id: string): Promise<ReferenceUsage>
}
