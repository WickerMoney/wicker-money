import { IMPORT_PLUGIN_ID } from '@wickermoney/plugin-import-csv/server'
import { asPlugin, type Db } from '../client.js'
import { pluginRoleName } from '../plugin-roles.js'
import { queryRunner } from '../../plugins/queryRunner.js'
import { addDays, todayIso } from './seedRng.js'

/**
 * Seeds two saved column mappings and two import batches for `hero`: one
 * reverted (an undone import, kept for its own history) and one live, linked
 * through `batch_transactions` to the two externally-identified transactions
 * `seedSpecialFixtures` created — so the batch's "view transactions" and
 * "revert" affordances have something real on the other end, not an empty
 * link table.
 *
 * Everything here is written under the import plugin's own database role via
 * `asPlugin`, exactly as `plugin_import_csv`'s real repositories do — the
 * application role itself has no grant on this schema (migration 008), so an
 * insert through `asUser` would fail with `permission denied for schema`.
 *
 * @param db - Application database handle.
 * @param userId - The persona's user id.
 * @param checkingAccountId - Account the batches are attributed to.
 * @param linkedTransactionIds - The two `externalId`-carrying transaction ids
 *   from {@link import('./seedTransactions.js').seedSpecialFixtures}.
 */
export async function createImportCsvFixtures(
  db: Db,
  userId: string,
  checkingAccountId: string,
  linkedTransactionIds: readonly [string, string],
): Promise<void> {
  const role = pluginRoleName(IMPORT_PLUGIN_ID)
  const today = todayIso()

  await asPlugin(db, role, userId, async (trx) => {
    const q = queryRunner(trx)

    await q`
      INSERT INTO plugin_import_csv.source_mappings
        (user_id, source_name, columns, date_format, amount_style, invert_amount)
      VALUES (
        core.current_user_id(), 'Chase Checking',
        ${JSON.stringify({ date: 'Transaction Date', amount: 'Amount', merchant: 'Description' })}::jsonb,
        'MM/DD/YYYY', 'signed', false
      )
      ON CONFLICT (user_id, lower(source_name)) DO NOTHING
    `
    await q`
      INSERT INTO plugin_import_csv.source_mappings
        (user_id, source_name, columns, date_format, amount_style, invert_amount)
      VALUES (
        core.current_user_id(), 'Amex Credit Card',
        ${JSON.stringify({ date: 'Date', amount: 'Amount', merchant: 'Description' })}::jsonb,
        'MM/DD/YYYY', 'signed', true
      )
      ON CONFLICT (user_id, lower(source_name)) DO NOTHING
    `

    await q`
      INSERT INTO plugin_import_csv.import_batches
        (user_id, account_id, source_name, file_name, rows_total, rows_imported, rows_skipped, rows_flagged, reverted_at)
      VALUES (
        core.current_user_id(), ${checkingAccountId}, 'Chase Checking', 'chase-export-2026-06.csv',
        42, 38, 3, 1, ${addDays(today, -95)}::timestamptz
      )
    `

    const active = await q<{ id: string }>`
      INSERT INTO plugin_import_csv.import_batches
        (user_id, account_id, source_name, file_name, rows_total, rows_imported, rows_skipped, rows_flagged)
      VALUES (
        core.current_user_id(), ${checkingAccountId}, 'Chase Checking', 'chase-export-recent.csv',
        2, 2, 0, 0
      )
      RETURNING id
    `
    const batchId = active[0]?.id
    if (batchId === undefined) return

    for (const transactionId of linkedTransactionIds) {
      await q`
        INSERT INTO plugin_import_csv.batch_transactions (batch_id, transaction_id, user_id)
        VALUES (${batchId}, ${transactionId}, core.current_user_id())
        ON CONFLICT DO NOTHING
      `
    }
  })
}
