import { sql } from 'kysely'
import { createIndexIfMissing, type Executor } from './support/index.js'

/**
 * @module
 * Drops `core.ix_transactions_merchant_trgm`, the trigram GIN index on
 * `core.transactions (merchant)` that migration 015 built for `ILIKE '%text%'`
 * search. Nothing the application can run is able to use it.
 *
 * Why it is dead weight. The ledger search runs as the application role, under
 * row-level security. A policy qualification is applied before any
 * user-supplied predicate, and PostgreSQL lets a predicate become an index
 * condition ahead of the policy only if its operator is leakproof. `texticlike`
 * (`ILIKE`), `textlike` (`LIKE`) and `lower(text)` are not leakproof
 * (`pg_proc.proleakproof` is false), and an owner that is not a superuser cannot
 * define a leakproof function. So under row-level security the planner can use
 * `user_id` from an index and must apply `ILIKE` as a filter on every row of
 * that person, whichever trigram index exists (composite or not). The plans
 * before and after are identical: `ix_transactions_user_date` or
 * `ix_transactions_user_merchant_id` is read and the pattern is a `Filter`.
 * Measured on 1M rows (the 0.9.0 deep-pages spike): the index costs 46 MB per
 * 1M rows and about 5% of insert time (14.82 s to 14.04 s for 200,000 rows) and
 * pays for nothing. It was also the slowest index build in migration 015.
 *
 * Result sets and their order are unchanged, since the index never took part in
 * either; `038_drop_unused_merchant_trgm_index.integration.test.ts` runs the
 * same searches before and after and compares them.
 *
 * A privileged role could still use it. A superuser, or a role with
 * `BYPASSRLS`, is not subject to the policy and gets the trigram index as an
 * index condition (23 ms against 145 ms in the spike's plans). If search ever
 * runs outside row-level security (an owner-side job, a replica with its own
 * access path), `down` restores the index exactly as 015 defined it.
 *
 * The `pg_trgm` extension is kept. Nothing else in the repository uses it, but
 * `down` needs it and an installed extension costs nothing; dropping it is a
 * separate decision.
 *
 * Locking. `DROP INDEX` takes a short `ACCESS EXCLUSIVE` lock on
 * `core.transactions` (it only removes catalog entries and unlinks a file at
 * commit), so it runs in the migration's own transaction. A re-run finds the
 * index gone and issues no statement, so it takes no lock, as every migration
 * here must (`migrations.idempotent.integration.test.ts`). `down` rebuilds the
 * index with a plain `CREATE INDEX`, as 015 did, which blocks writes to
 * `core.transactions` for the length of the build (the slowest index here);
 * the hosted-scale note in the backlog (build concurrently) applies to it too.
 */

const INDEX = 'core.ix_transactions_merchant_trgm'

/** Exactly the definition migration 015 used (everything after the index name). */
const DEFINITION = 'ON core.transactions USING gin (merchant gin_trgm_ops)'

/**
 * Drops the trigram index on `merchant` if it exists.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Executor): Promise<void> {
  const { rows } = await sql<{ found: boolean }>`SELECT to_regclass(${INDEX}) IS NOT NULL AS found`.execute(db)
  if (rows[0]?.found !== true) return
  await sql`DROP INDEX IF EXISTS ${sql.raw(INDEX)}`.execute(db)
}

/**
 * Recreates the index with the definition migration 015 gave it, built
 * non-concurrently as 015 did. Installs `pg_trgm` if it is missing.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Executor): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(db)
  await createIndexIfMissing(db, INDEX, DEFINITION)
}
