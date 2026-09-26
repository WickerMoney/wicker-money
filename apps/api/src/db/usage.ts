import { sql, type Transaction as KyselyTransaction } from 'kysely'
import type { Database } from './models/index.js'

/**
 * What references one row, discovered rather than hardcoded.
 *
 * Answers the question "what is holding this, and can it go?" for any parent
 * table (categories, accounts, ...). A hardcoded list of
 * referencing tables goes stale the moment a plugin adds a foreign key to a
 * core table -- and it goes stale *quietly*, since the delete would still be
 * refused, just by a raw constraint violation instead of a sentence. Reading
 * `pg_constraint` keeps core ignorant of plugin schemas and still correct
 * about them.
 */
export interface ReferenceUsage {
  /** Total number of referencing rows across all readable tables. */
  readonly total: number
  /** Per-table breakdown (schema-qualified table name and row count); tables with zero references are omitted. */
  readonly by: readonly { readonly table: string; readonly count: number }[]
  /**
   * Tables that reference the row but this connection cannot read.
   *
   * Reported rather than counted as zero: "nothing uses this" and "I could not
   * check" are different answers, and only one of them makes a delete safe.
   */
  readonly unreadable: readonly string[]
}

/** A foreign-key column found in the catalog, and whether the current role may read its table. */
interface ReferencingColumn {
  schema: string
  table: string
  column: string
  readable: boolean
}

/** Kysely transaction over the application schema. */
type Trx = KyselyTransaction<Database>

/** PostgreSQL identifier quoting, for names read back out of the catalog. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/**
 * Finds every foreign-key column, anywhere, that references `parentTable` and
 * whose name matches `columnSuffix` (a SQL `LIKE` pattern, e.g. `%category_id`
 * or `%account_id`).
 *
 * A composite key is `(user_id, <parent>_id)`; the suffix match is what picks
 * out only the ownership half of it. `confrelid` and the column name come back
 * from `pg_catalog`, never from a caller, so nothing here is a place to worry
 * about SQL injection despite the string-built `FROM`/`WHERE` clauses below.
 *
 * @param trx - Transaction to query the catalog on.
 * @param parentTable - Referenced table, as a `regclass`-castable name (e.g. `core.accounts`).
 * @param columnSuffix - SQL `LIKE` pattern for the referencing column name.
 * @returns One entry per matching foreign-key column.
 */
async function findReferencingColumns(
  trx: Trx,
  parentTable: string,
  columnSuffix: string,
): Promise<ReferencingColumn[]> {
  const refs = await sql<ReferencingColumn>`
    SELECT DISTINCT
      ns.nspname                             AS schema,
      rel.relname                            AS table,
      att.attname                            AS column,
      has_table_privilege(rel.oid, 'SELECT') AS readable
    FROM pg_constraint con
    JOIN pg_class      rel ON rel.oid = con.conrelid
    JOIN pg_namespace  ns  ON ns.oid  = rel.relnamespace
    JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute  att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
    WHERE con.contype = 'f'
      AND con.confrelid = ${parentTable}::regclass
      AND att.attname LIKE ${columnSuffix}
  `.execute(trx)
  return refs.rows
}

/**
 * Counts how many rows point at `targetId`, table by table.
 *
 * Columns are grouped by table before counting: `core.accounts` is referenced
 * by both `account_id` and `transfer_account_id` on `core.transactions`, and
 * counting each column separately would list "core.transactions" twice in
 * `by` for what a person reads as one table's worth of usage. A single query
 * per table, OR-ing every matching column, gives one number per table and
 * cannot double count a row -- the `ck_transactions_transfer_not_self` check
 * constraint guarantees the two columns are never simultaneously equal on one row.
 *
 * @param trx - Transaction to run the counts on (row-level security applies).
 * @param parentTable - Referenced table, as a `regclass`-castable name (e.g. `core.categories`).
 * @param columnSuffix - SQL `LIKE` pattern selecting the referencing columns (e.g. `%category_id`).
 * @param targetId - Id of the parent row being checked.
 * @returns Per-table counts plus any tables that could not be read.
 * @example
 * const usage = await summarizeUsage(trx, 'core.categories', '%category_id', id)
 * if (usage.total > 0 || usage.unreadable.length > 0) refuseDelete(usage)
 */
export async function summarizeUsage(
  trx: Trx,
  parentTable: string,
  columnSuffix: string,
  targetId: string,
): Promise<ReferenceUsage> {
  const refs = await findReferencingColumns(trx, parentTable, columnSuffix)

  const byTable = new Map<
    string,
    { schema: string; table: string; columns: string[]; readable: boolean }
  >()
  for (const ref of refs) {
    const key = `${ref.schema}.${ref.table}`
    const existing = byTable.get(key)
    if (existing === undefined) {
      byTable.set(key, { schema: ref.schema, table: ref.table, columns: [ref.column], readable: ref.readable })
    } else {
      existing.columns.push(ref.column)
      // A table found unreadable through one FK column is unreadable through
      // any of them -- table-level privilege, not column-level.
      existing.readable = existing.readable && ref.readable
    }
  }

  const by: { table: string; count: number }[] = []
  const unreadable: string[] = []
  let total = 0

  for (const { schema, table, columns, readable } of byTable.values()) {
    const qualified = `${schema}.${table}`
    if (!readable) {
      unreadable.push(qualified)
      continue
    }
    const predicate = sql.join(
      columns.map((c) => sql`${sql.raw(quoteIdent(c))} = ${targetId}`),
      sql` OR `,
    )
    const counted = await sql<{ n: string }>`
      SELECT count(*)::text AS n
      FROM ${sql.raw(`${quoteIdent(schema)}.${quoteIdent(table)}`)}
      WHERE ${predicate}
    `.execute(trx)
    const n = Number(counted.rows[0]?.n ?? 0)
    if (n > 0) {
      by.push({ table: qualified, count: n })
      total += n
    }
  }

  return { total, by, unreadable }
}
