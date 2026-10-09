import type { SourceMapping } from '../../shared/index.js'
import type { MappingRepository } from './MappingRepository.js'
import type { Query } from '@wickermoney/plugin-sdk/server'
import type { SavedMappingRow } from './SavedMappingRow.js'

/** {@link MappingRepository} over the plugin's query runner. */
export class QueryMappingRepository implements MappingRepository {
  /** @param q - A query runner bound to the current user. */
  constructor(private readonly q: Query) {}

  /** @inheritdoc */
  list(): Promise<SavedMappingRow[]> {
    return this.q<SavedMappingRow>`
      SELECT id, source_name AS "sourceName", columns, date_format AS "dateFormat",
             amount_style AS "amountStyle", invert_amount AS "invertAmount"
      FROM plugin_import_csv.source_mappings
      ORDER BY lower(source_name)
    `
  }

  /** @inheritdoc */
  async save(mapping: SourceMapping): Promise<string | undefined> {
    const rows = await this.q<{ id: string }>`
      INSERT INTO plugin_import_csv.source_mappings
        (user_id, source_name, columns, date_format, amount_style, invert_amount)
      VALUES (core.current_user_id(), ${mapping.sourceName}, ${JSON.stringify(mapping.columns)}::jsonb,
              ${mapping.dateFormat}, ${mapping.amountStyle}, ${mapping.invertAmount})
      ON CONFLICT (user_id, lower(source_name)) DO UPDATE SET
        columns = EXCLUDED.columns,
        date_format = EXCLUDED.date_format,
        amount_style = EXCLUDED.amount_style,
        invert_amount = EXCLUDED.invert_amount,
        updated_at = now()
      RETURNING id
    `
    return rows[0]?.id
  }
}
