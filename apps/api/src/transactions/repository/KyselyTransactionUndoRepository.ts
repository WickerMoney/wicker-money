import { sql } from 'kysely'
import { translateDuplicateKey } from '../../data/translateDuplicateKey.js'
import type { UndoSnapshotKind } from '../../db/models/index.js'
import type { Trx } from '../../db/Trx.js'
import type { TransactionUndoRepository } from './TransactionUndoRepository.js'
import { UNDO_PAYLOAD_MAX_BYTES } from './UNDO_PAYLOAD_MAX_BYTES.js'
import type { UndoMissingReferences } from './UndoMissingReferences.js'
import type { UndoRestoreCounts } from './UndoRestoreCounts.js'
import type { UndoSnapshot } from './UndoSnapshot.js'
import type { UndoSnapshotState } from './UndoSnapshotState.js'

/** Kysely implementation of {@link TransactionUndoRepository}. */
export class KyselyTransactionUndoRepository implements TransactionUndoRepository {
  /** @param trx - The transaction all queries run on. */
  constructor(protected readonly trx: Trx) {}

  /** @inheritdoc */
  async capture(input: {
    readonly userId: string
    readonly kind: UndoSnapshotKind
    readonly transactionIds: readonly string[]
    readonly ttlSeconds: number
  }): Promise<UndoSnapshot | undefined> {
    const ids = [...input.transactionIds]
    if (ids.length === 0) return undefined
    // The payload is measured before it is written: a CHECK violation would
    // abort the whole delete, and the delete must not fail for this.
    const { rows } = await sql<{ id: string; kind: UndoSnapshotKind; expires_at: Date }>`
      WITH p AS (
        SELECT jsonb_build_object(
          'transactions', (
            SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb)
            FROM core.transactions t WHERE t.id = ANY(${ids}::uuid[])
          ),
          'splits', (
            SELECT coalesce(jsonb_agg(to_jsonb(sp) ORDER BY sp.id), '[]'::jsonb)
            FROM core.transaction_splits sp WHERE sp.transaction_id = ANY(${ids}::uuid[])
          ),
          'dismissals', (
            SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id), '[]'::jsonb)
            FROM core.recurring_match_dismissals d WHERE d.transaction_id = ANY(${ids}::uuid[])
          )
        ) AS payload
      )
      INSERT INTO core.transaction_undo_snapshots (user_id, kind, payload, transaction_count, expires_at)
      SELECT ${input.userId}::uuid, ${input.kind}, p.payload,
             jsonb_array_length(p.payload -> 'transactions')::smallint,
             now() + make_interval(secs => ${input.ttlSeconds}::double precision)
      FROM p
      WHERE jsonb_array_length(p.payload -> 'transactions') BETWEEN 1 AND 2
        AND octet_length(p.payload::text) <= ${UNDO_PAYLOAD_MAX_BYTES}
      RETURNING id, kind, expires_at
    `.execute(this.trx)
    const row = rows[0]
    return row === undefined ? undefined : { id: row.id, kind: row.kind, expiresAt: row.expires_at }
  }

  /** @inheritdoc */
  async purgeExpired(exceptId?: string): Promise<number> {
    const result = await this.trx
      .deleteFrom('core.transaction_undo_snapshots')
      .where(sql<boolean>`expires_at < now()`)
      .$if(exceptId !== undefined, (q) => q.where('id', '<>', exceptId as string))
      .executeTakeFirst()
    return Number(result.numDeletedRows)
  }

  /** @inheritdoc */
  async enforceCap(limit: number): Promise<number> {
    const result = await sql`
      DELETE FROM core.transaction_undo_snapshots
      WHERE id IN (
        SELECT id FROM core.transaction_undo_snapshots
        WHERE restored_at IS NULL AND expires_at >= now()
        ORDER BY created_at DESC, id DESC
        OFFSET ${limit}
      )
    `.execute(this.trx)
    return Number(result.numAffectedRows ?? 0)
  }

  /** @inheritdoc */
  async lock(id: string): Promise<UndoSnapshotState | undefined> {
    const { rows } = await sql<{ id: string; kind: UndoSnapshotKind; restored: boolean; expired: boolean }>`
      SELECT id, kind, restored_at IS NOT NULL AS restored, expires_at < now() AS expired
      FROM core.transaction_undo_snapshots
      WHERE id = ${id}::uuid
      FOR UPDATE
    `.execute(this.trx)
    return rows[0]
  }

  /** @inheritdoc */
  async missingReferences(id: string): Promise<UndoMissingReferences> {
    const { rows } = await sql<{ accounts: number; categories: number }>`
      WITH snap AS (SELECT s.payload FROM core.transaction_undo_snapshots s WHERE s.id = ${id}::uuid),
      accts AS (
        SELECT DISTINCT v.x AS id
        FROM snap,
             jsonb_array_elements(snap.payload -> 'transactions') e,
             LATERAL (VALUES ((e ->> 'account_id')::uuid), ((e ->> 'transfer_account_id')::uuid)) v(x)
        WHERE v.x IS NOT NULL
      ),
      cats AS (
        SELECT DISTINCT c.x AS id FROM (
          SELECT (e ->> 'category_id')::uuid AS x
          FROM snap, jsonb_array_elements(snap.payload -> 'transactions') e
          UNION ALL
          SELECT (e ->> 'category_id')::uuid
          FROM snap, jsonb_array_elements(snap.payload -> 'splits') e
        ) c
        WHERE c.x IS NOT NULL
      )
      SELECT
        (SELECT count(*) FROM accts a WHERE NOT EXISTS (SELECT 1 FROM core.accounts x WHERE x.id = a.id))::int AS accounts,
        (SELECT count(*) FROM cats c WHERE NOT EXISTS (SELECT 1 FROM core.categories x WHERE x.id = c.id))::int AS categories
    `.execute(this.trx)
    return { accounts: rows[0]?.accounts ?? 0, categories: rows[0]?.categories ?? 0 }
  }

  /** @inheritdoc */
  async externalIdTaken(id: string): Promise<boolean> {
    const { rows } = await sql<{ taken: boolean }>`
      SELECT EXISTS (
        SELECT 1
        FROM core.transaction_undo_snapshots s,
             jsonb_populate_recordset(NULL::core.transactions, s.payload -> 'transactions') p
        JOIN core.transactions t ON t.account_id = p.account_id AND t.external_id = p.external_id
        WHERE s.id = ${id}::uuid AND p.external_id IS NOT NULL
      ) AS taken
    `.execute(this.trx)
    return rows[0]?.taken === true
  }

  /** @inheritdoc */
  async restore(id: string): Promise<UndoRestoreCounts> {
    // Rows go in with `INSERT ... SELECT` from `jsonb_populate_recordset` over
    // the table's own row type, so the restore does not name a column: one a
    // later migration adds is carried by the snapshot and restored with it
    // (the round-trip test fails if it is not).
    const transactions = await translateDuplicateKey(async () => {
      const { rows } = await sql<{ restored: number; relinked: number }>`
        WITH snap AS (SELECT s.payload FROM core.transaction_undo_snapshots s WHERE s.id = ${id}::uuid),
        src AS (
          SELECT e AS j,
                 (e ->> 'recurring_occurrence_id') IS NOT NULL AS had_link,
                 EXISTS (
                   SELECT 1 FROM core.recurring_occurrences o WHERE o.id = (e ->> 'recurring_occurrence_id')::uuid
                 ) AS link_ok
          FROM snap, jsonb_array_elements(snap.payload -> 'transactions') e
        ),
        ins AS (
          INSERT INTO core.transactions
          SELECT p.*
          FROM src,
               LATERAL jsonb_populate_record(
                 NULL::core.transactions,
                 CASE WHEN src.had_link AND NOT src.link_ok
                      THEN src.j || '{"recurring_occurrence_id": null}'::jsonb
                      ELSE src.j END
               ) p
          RETURNING id
        )
        SELECT (SELECT count(*) FROM ins)::int AS restored,
               (SELECT count(*) FROM src WHERE had_link AND link_ok)::int AS relinked
      `.execute(this.trx)
      return rows[0] ?? { restored: 0, relinked: 0 }
    })

    await sql`
      INSERT INTO core.transaction_splits
      SELECT * FROM jsonb_populate_recordset(
        NULL::core.transaction_splits,
        (SELECT s.payload -> 'splits' FROM core.transaction_undo_snapshots s WHERE s.id = ${id}::uuid)
      )
    `.execute(this.trx)

    const { rows: dismissals } = await sql<{ total: number; restored: number }>`
      WITH snap AS (SELECT s.payload -> 'dismissals' AS d FROM core.transaction_undo_snapshots s WHERE s.id = ${id}::uuid),
      ins AS (
        INSERT INTO core.recurring_match_dismissals
        SELECT d.*
        FROM snap, jsonb_populate_recordset(NULL::core.recurring_match_dismissals, snap.d) d
        WHERE EXISTS (SELECT 1 FROM core.recurring_items i WHERE i.id = d.recurring_item_id)
        RETURNING id
      )
      SELECT (SELECT jsonb_array_length(d) FROM snap)::int AS total,
             (SELECT count(*) FROM ins)::int AS restored
    `.execute(this.trx)
    const total = dismissals[0]?.total ?? 0
    const restoredDismissals = dismissals[0]?.restored ?? 0

    await sql`
      UPDATE core.transaction_undo_snapshots
      SET restored_at = now(), payload = '{}'::jsonb
      WHERE id = ${id}::uuid
    `.execute(this.trx)

    return {
      restored: transactions.restored,
      relinkedMatch: transactions.relinked > 0,
      restoredDismissals,
      skippedDismissals: total - restoredDismissals,
    }
  }

  /** @inheritdoc */
  async purgeAllExpired(): Promise<number> {
    const { rows } = await sql<{ purged: string }>`
      SELECT core.purge_expired_transaction_undos() AS purged
    `.execute(this.trx)
    return Number(rows[0]?.purged ?? 0)
  }
}
