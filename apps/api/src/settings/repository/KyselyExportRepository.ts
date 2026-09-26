import { sql } from 'kysely'
import type { Trx } from '../../db/Trx.js'
import { pluginRoleName } from '../../db/plugin-roles.js'
import type { PluginQuery } from '../../plugins/PluginQuery.js'
import { queryRunner } from '../../plugins/queryRunner.js'
import type { ExportRepository } from './ExportRepository.js'
import type { ExportRow } from './ExportRow.js'
import type { ExportTable } from './ExportTable.js'
import type { ExportedProfile } from './ExportedProfile.js'

/** The table each {@link ExportTable} reads from. A fixed map, so no table name is ever built from input. */
const TABLE_REFS: Readonly<Record<ExportTable, ReturnType<typeof sql.table>>> = {
  accounts: sql.table('core.accounts'),
  categories: sql.table('core.categories'),
  category_rules: sql.table('core.category_rules'),
  category_rule_conditions: sql.table('core.category_rule_conditions'),
  transactions: sql.table('core.transactions'),
  transaction_splits: sql.table('core.transaction_splits'),
  recurring_items: sql.table('core.recurring_items'),
}

/** Kysely implementation of {@link ExportRepository} over a single transaction. */
export class KyselyExportRepository implements ExportRepository {
  /** @param trx - The transaction all queries run on. */
  constructor(protected readonly trx: Trx) {}

  /** @inheritdoc */
  readProfile(userId: string): Promise<ExportedProfile | undefined> {
    // `password_hash` is deliberately not selected.
    return this.trx
      .selectFrom('core.users')
      .select(['id', 'email', 'timezone', 'onboarded_at', 'onboarding_situations', 'created_at'])
      .where('id', '=', userId)
      .executeTakeFirst()
  }

  /** @inheritdoc */
  async readPage(table: ExportTable, afterId: string | undefined, limit: number): Promise<ExportRow[]> {
    const after = afterId === undefined ? sql`` : sql`WHERE id > ${afterId}::uuid`
    const result = await sql<ExportRow>`
      SELECT * FROM ${TABLE_REFS[table]} ${after} ORDER BY id LIMIT ${limit}
    `.execute(this.trx)
    return result.rows
  }

  /** @inheritdoc */
  async runAsPlugin<T>(pluginId: string, work: (q: PluginQuery) => Promise<T>): Promise<T> {
    const role = pluginRoleName(pluginId)
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
      throw new Error(`Refusing to SET ROLE to a non-identifier: ${role}`)
    }
    await sql`SET LOCAL ROLE ${sql.raw(role)}`.execute(this.trx)
    const result = await work(queryRunner(this.trx))
    await sql`RESET ROLE`.execute(this.trx)
    return result
  }

  /** @inheritdoc */
  async latestMigrationName(): Promise<string | null> {
    const { rows } = await sql<{ name: string }>`
      SELECT name FROM kysely_migration ORDER BY name DESC LIMIT 1
    `.execute(this.trx)
    return rows[0]?.name ?? null
  }
}
