import { sql, type Kysely, type Transaction } from 'kysely'
import type { Database } from '../../../db/models/index.js'
import type { RuleRowRunner } from './RuleRowRunner.js'

/**
 * Adapts a Kysely handle or transaction into the tagged-template runner shape
 * that `fetchRulesInResolutionOrder` expects.
 *
 * Callers that already have a runner of that shape (for example a plugin's
 * scoped query function) need no adapter.
 *
 * @param trx - Kysely instance or transaction to execute queries on.
 * @returns A {@link RuleRowRunner} that resolves to the result rows.
 */
export function kyselyRunner(trx: Kysely<Database> | Transaction<Database>): RuleRowRunner {
  return (async <T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> => {
    const result = await sql<T>(strings, ...values).execute(trx)
    return result.rows
  }) as RuleRowRunner
}
