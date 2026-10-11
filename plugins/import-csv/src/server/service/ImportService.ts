import { summarize, type MappedRow } from '../../shared/index.js'
import { isIdempotencyKeyConflict } from '../repository/isIdempotencyKeyConflict.js'
import type { ImportRepositories } from '../repository/ImportRepositories.js'
import type { ImportUnitOfWork } from '../repository/ImportUnitOfWork.js'
import type { BatchListRow } from '../repository/BatchListRow.js'
import type { SavedMappingRow } from '../repository/SavedMappingRow.js'
import type { SourceMapping } from '../../shared/index.js'
import { ANALYZE_PREVIEW_ROWS } from './ANALYZE_PREVIEW_ROWS.js'
import type { AnalyzeInput } from './AnalyzeInput.js'
import type { AnalyzePage } from './AnalyzePage.js'
import type { AnalyzeResult } from './AnalyzeResult.js'
import { BATCH_HISTORY_LIMIT } from './BATCH_HISTORY_LIMIT.js'
import type { CategoryResolver } from './CategoryResolver.js'
import { classifyAgainstLedger } from './classifyAgainstLedger.js'
import { DEFAULT_FLAGGED_LIMIT } from './DEFAULT_FLAGGED_LIMIT.js'
import type { CommitInput } from './CommitInput.js'
import type { CommitResult } from './CommitResult.js'
import { ImportError } from './ImportError.js'
import { mapFile } from './mapFile.js'
import { pageOfFlagged } from './pageOfFlagged.js'
import { MAX_ROW_ERRORS_SHOWN } from './MAX_ROW_ERRORS_SHOWN.js'
import { requireVisibleAccount } from './requireVisibleAccount.js'
import type { RevertResult } from './RevertResult.js'
import { selectRowsToImport } from './selectRowsToImport.js'
import { toAnalyzedRow } from './toAnalyzedRow.js'
import { toLedgerRows } from './toLedgerRows.js'
import { toReplayedResult } from './toReplayedResult.js'

/**
 * The CSV import use cases: preview a file, write it as one batch, undo a
 * batch, and manage saved source mappings.
 *
 * Preview and commit share the same mapping and classification functions on the
 * same text, so what the user approves is what is written.
 */
export class ImportService {
  /**
   * @param uow - Opens the per-request transaction and hands out repositories.
   * @param resolveCategory - The host's category rule engine.
   * @param maxRows - The most data rows one import may contain (the host's `IMPORT_MAX_ROWS`).
   */
  constructor(
    private readonly uow: ImportUnitOfWork,
    private readonly resolveCategory: CategoryResolver,
    private readonly maxRows: number,
  ) {}

  /**
   * Lists the user's saved source mappings.
   *
   * @param userId - The authenticated user.
   * @returns The mappings, ordered case-insensitively by source name.
   */
  listMappings(userId: string): Promise<SavedMappingRow[]> {
    return this.uow.run(userId, (repos) => repos.mappings.list())
  }

  /**
   * Saves a source mapping, replacing any with the same name (case-insensitive).
   *
   * @param userId - The authenticated user.
   * @param mapping - The validated mapping.
   * @returns The id of the stored mapping, or `null` if none was returned.
   */
  async saveMapping(userId: string, mapping: SourceMapping): Promise<string | null> {
    const id = await this.uow.run(userId, (repos) => repos.mappings.save(mapping))
    return id ?? null
  }

  /**
   * Parses and classifies a file without writing anything.
   *
   * The whole file is classified, but the response carries a bounded slice of
   * it: the counts for every row, the first rows of the file, and one page of
   * the rows the user must decide on. Rows not returned are still handled
   * correctly by {@link commit}, which classifies the file again and acts on
   * row numbers, never on what an analysis showed.
   *
   * @param userId - The authenticated user.
   * @param input - The account, CSV text and mapping.
   * @param page - Which flagged rows to return. Defaults to the first {@link DEFAULT_FLAGGED_LIMIT}.
   * @returns The summary, the first row errors, the first rows of the file, and a page of flagged rows.
   * @throws {ImportError} `400` when the file has too many rows; `404` when the account is not visible.
   */
  async analyze(
    userId: string,
    input: AnalyzeInput,
    page: AnalyzePage = { offset: 0, limit: DEFAULT_FLAGGED_LIMIT },
  ): Promise<AnalyzeResult> {
    const { rows, errors } = mapFile(input.csv, input.mapping, this.maxRows)
    return this.uow.run(userId, async (repos) => {
      await requireVisibleAccount(repos.accounts, input.accountId)
      const classified = await classifyAgainstLedger(repos.ledger, input.accountId, rows)
      const summary = summarize(classified)
      return {
        summary: { ...summary, errors: errors.length },
        errors: errors.slice(0, MAX_ROW_ERRORS_SHOWN),
        rows: classified.slice(0, ANALYZE_PREVIEW_ROWS).map(toAnalyzedRow),
        flagged: {
          total: summary.needsReview,
          offset: page.offset,
          rows: pageOfFlagged(classified, page).map(toAnalyzedRow),
        },
      }
    })
  }

  /**
   * Writes the import as one batch.
   *
   * Everything runs in a single transaction, so either the batch and all its
   * rows exist or neither does; a half-written import would invite a re-run
   * that double-imports the half that succeeded. Concurrent imports into the
   * same account take turns, so the second sees what the first wrote. Rows
   * classified `new` are imported, `needs-review` rows only when accepted, and
   * duplicates never. A row that loses a race to a concurrent writer of the
   * same external id is counted as skipped rather than failing the import.
   *
   * When the input carries an idempotency key, the key is stored on the batch
   * and a repeat of the same key (retry, double click, or a concurrent copy)
   * writes nothing and returns the first commit's outcome with `replayed: true`.
   * The key is looked up under the account lock, so a sequential repeat and one
   * that waited on the lock both find the batch; two requests that do not share
   * a lock are stopped by the unique index instead, and the loser's rolled-back
   * transaction is answered from the batch that won.
   *
   * @param userId - The authenticated user.
   * @param input - The account, CSV text, mapping, file name, accepted row numbers and optional key.
   * @returns The batch id and the counters.
   * @throws {ImportError} `400` when the file has too many rows; `404` when the
   *   account is not visible; `500` when the batch row cannot be created.
   */
  async commit(userId: string, input: CommitInput): Promise<CommitResult> {
    const { rows, errors } = mapFile(input.csv, input.mapping, this.maxRows)
    const key = input.idempotencyKey

    try {
      return await this.uow.run(userId, (repos) => this.writeBatch(repos, userId, input, rows, errors.length))
    } catch (error) {
      if (key === undefined || !isIdempotencyKeyConflict(error)) throw error
      // The failed statement aborted the transaction above, so the winner is
      // read in a new one.
      const original = await this.uow.run(userId, (repos) => repos.batches.findByIdempotencyKey(key))
      if (original === undefined) throw error
      return toReplayedResult(original, errors.length)
    }
  }

  /**
   * Runs one commit inside an open transaction.
   *
   * @param repos - Repositories bound to the transaction.
   * @param userId - The authenticated user.
   * @param input - The commit request.
   * @param rows - The file's mapped rows.
   * @param failed - How many rows of the file could not be mapped.
   * @returns The new batch's outcome, or the original one when the key was already used.
   */
  private async writeBatch(
    repos: ImportRepositories,
    userId: string,
    input: CommitInput,
    rows: readonly MappedRow[],
    failed: number,
  ): Promise<CommitResult> {
    await requireVisibleAccount(repos.accounts, input.accountId)
    await repos.locks.lockAccount(userId, input.accountId)

    if (input.idempotencyKey !== undefined) {
      const original = await repos.batches.findByIdempotencyKey(input.idempotencyKey)
      if (original !== undefined) return toReplayedResult(original, failed)
    }

    const classified = await classifyAgainstLedger(repos.ledger, input.accountId, rows)
    const counts = summarize(classified)
    const toImport = selectRowsToImport(classified, new Set(input.acceptRowNumbers))

    // Rules are read once and applied in memory, so categorising costs no
    // per-row query. The host owns the resolution order.
    const rules = await repos.categoryRules.loadForMatching()
    const written = await repos.ledger.insertImported(
      input.accountId,
      toLedgerRows(toImport, rules, this.resolveCategory),
    )

    // A row can be absent from `written` when the unique index caught a
    // duplicate that arrived between analysis and commit; it counts as skipped.
    const batchId = await repos.batches.create({
      accountId: input.accountId,
      sourceName: input.mapping.sourceName,
      fileName: input.fileName,
      rowsTotal: rows.length,
      rowsImported: written.length,
      rowsSkipped: counts.duplicate + (toImport.length - written.length),
      rowsFlagged: counts.needsReview,
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    })
    if (batchId === undefined) throw new ImportError('Could not create the import batch.', 500)
    await repos.batchLinks.linkMany(batchId, written)

    return {
      batchId,
      imported: written.length,
      skipped: counts.duplicate,
      flagged: counts.needsReview,
      failed,
    }
  }

  /**
   * Lists the user's most recent import batches.
   *
   * @param userId - The authenticated user.
   * @returns Up to 25 batches with their account names, newest first.
   */
  listBatches(userId: string): Promise<BatchListRow[]> {
    return this.uow.run(userId, (repos) => repos.batches.listRecent(BATCH_HISTORY_LIMIT))
  }

  /**
   * Undoes one import.
   *
   * Deletes only transactions this batch created, found through its link table
   * rather than by re-deriving them from the file, which would also match rows
   * entered by hand that look the same. A transaction edited, split,
   * categorised by hand or turned into a transfer since import is kept and
   * counted in `skipped`, because deleting it would destroy the user's work.
   *
   * @param userId - The authenticated user.
   * @param batchId - The batch to revert.
   * @returns How many transactions were deleted and how many were kept.
   * @throws {ImportError} `404` when no such batch is visible to the user; `409`
   *   (`already_reverted`) when it was reverted before.
   */
  revert(userId: string, batchId: string): Promise<RevertResult> {
    return this.uow.run(userId, async (repos) => {
      const batch = await repos.batches.findById(batchId)
      if (batch === undefined) throw new ImportError('No such import batch.', 404, 'not_found')
      if (batch.revertedAt !== null) {
        throw new ImportError('That import has already been reverted.', 409, 'already_reverted')
      }
      const reverted = await repos.ledger.deleteUntouchedInBatch(batchId)
      const skipped = await repos.ledger.countInBatch(batchId)
      await repos.batches.markReverted(batchId)
      return { reverted, skipped }
    })
  }
}
