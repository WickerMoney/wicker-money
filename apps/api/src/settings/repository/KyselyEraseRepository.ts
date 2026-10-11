import { sql } from 'kysely'
import { setLocalRole } from '../../db/client.js'
import { pluginRoleName, pluginSchemaName } from '../../db/plugin-roles.js'
import type { Trx } from '../../db/Trx.js'
import { CORE_ERASE_ORDER, PLUGIN_ERASE_PLANS } from '../service/ERASE_PLAN.js'
import type { EraseRepository } from './EraseRepository.js'
import type { InstanceActivity } from './InstanceActivity.js'

/** A plain lowercase PostgreSQL identifier, the only shape a table or schema name may take here. */
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/

/** Kysely implementation of {@link EraseRepository} over a single transaction. */
export class KyselyEraseRepository implements EraseRepository {
  /** @param trx - The transaction all queries run on. */
  constructor(private readonly trx: Trx) {}

  /** @inheritdoc */
  async userTables(): Promise<readonly string[]> {
    const { rows } = await sql<{ name: string }>`
      SELECT n.nspname || '.' || c.relname AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p')
        AND (n.nspname = 'core' OR starts_with(n.nspname, 'plugin_'))
        AND EXISTS (
          SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped
        )
      ORDER BY 1
    `.execute(this.trx)
    return rows.map((r) => r.name)
  }

  /** @inheritdoc */
  async deleteCoreRows(table: string, userId: string): Promise<number> {
    if (!CORE_ERASE_ORDER.includes(table)) throw new Error(`core.${table} is not in the erase plan.`)
    return this.deleteOwn(`core.${table}`, userId)
  }

  /** @inheritdoc */
  async deletePluginRows(pluginId: string, table: string, userId: string): Promise<number> {
    const plan = PLUGIN_ERASE_PLANS.find((p) => p.pluginId === pluginId)
    if (plan === undefined || !plan.tables.includes(table)) {
      throw new Error(`${pluginId} / ${table} is not in the erase plan.`)
    }
    await setLocalRole(this.trx, pluginRoleName(pluginId))
    const deleted = await this.deleteOwn(`${pluginSchemaName(pluginId)}.${table}`, userId)
    await sql`RESET ROLE`.execute(this.trx)
    return deleted
  }

  /** @inheritdoc */
  deleteSessions(userId: string): Promise<number> {
    return this.deleteOwn('core.sessions', userId)
  }

  /** @inheritdoc */
  async instanceActivity(excludeFamilyId: string): Promise<InstanceActivity> {
    const { rows } = await sql<{ other_sessions: string; other_users: string }>`
      SELECT other_sessions, other_users FROM core.instance_activity(${excludeFamilyId}::uuid)
    `.execute(this.trx)
    return {
      otherSessions: Number(rows[0]?.other_sessions ?? 0),
      otherUsers: Number(rows[0]?.other_users ?? 0),
    }
  }

  /** @inheritdoc */
  async eraseInstance(): Promise<void> {
    await sql`SELECT core.erase_instance()`.execute(this.trx)
  }

  /**
   * `DELETE ... WHERE user_id = $1` on a table whose name was checked against
   * the plan by the caller. The name still has to be a plain identifier pair
   * before it is quoted into SQL text.
   */
  private async deleteOwn(qualified: string, userId: string): Promise<number> {
    const parts = qualified.split('.')
    if (parts.length !== 2 || !parts.every((p) => IDENTIFIER.test(p))) {
      throw new Error(`Refusing to delete from ${qualified}.`)
    }
    const result = await sql`DELETE FROM ${sql.table(qualified)} WHERE user_id = ${userId}::uuid`.execute(this.trx)
    return Number(result.numAffectedRows ?? 0)
  }
}
