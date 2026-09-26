import { sql } from 'kysely'
import type { Trx } from '../db/Trx.js'
import type { PluginQuery } from './PluginQuery.js'
import { assertSafePluginSql } from './assertSafePluginSql.js'

/**
 * Wraps a Kysely transaction as the tagged-template runner plugins receive.
 *
 * Every statement is screened first: text that changes the database role or a
 * session setting is refused, so plugin code cannot undo the role and user
 * binding the host established on `trx`. Anything else runs on `trx` as
 * written, with values sent as bound parameters.
 *
 * Exported so that code calling a bundled plugin's functions outside the HTTP
 * route-mounting path (a data export, for instance) builds exactly the same
 * runner.
 *
 * @param trx - The transaction to run queries on, already bound to a user and role.
 * @returns A tagged-template function that executes SQL on `trx` and resolves to the result rows.
 */
export function queryRunner(trx: Trx): PluginQuery {
  return async <T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> => {
    assertSafePluginSql(strings)
    const result = await sql<T>(strings, ...values).execute(trx)
    return result.rows
  }
}
