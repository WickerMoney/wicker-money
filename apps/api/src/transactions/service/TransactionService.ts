import { randomUUID } from 'node:crypto'
import { DuplicateKeyError } from '../../data/DuplicateKeyError.js'
import type { UnitOfWork } from '../../data/UnitOfWork.js'
import type { Transaction, TransactionSplit } from '../../db/models/index.js'
import { resolveCategory } from '../../categories/engine.js'
import { ConflictError, NotFoundError, ValidationError } from '../../errors.js'
import { money, negate } from '../../money.js'
import { assertCategoriesExist } from './assertCategoriesExist.js'
import { assertAmountEditAllowed } from './assertAmountEditAllowed.js'
import { assertTransferFlagUntouched } from './assertTransferFlagUntouched.js'
import { lockForEdit } from './lockForEdit.js'
import { assertValidSplits } from './assertValidSplits.js'
import { buildSiblingChanges } from './buildSiblingChanges.js'
import { buildTransactionChanges } from './buildTransactionChanges.js'
import { cursorAfter } from './cursorAfter.js'
import type { CategorizeResult } from './CategorizeResult.js'
import type { NewTransaction } from './NewTransaction.js'
import type { NewTransfer } from './NewTransfer.js'
import type { SplitPart } from './SplitPart.js'
import type { TransactionListQuery } from './TransactionListQuery.js'
import type { TransactionListResult } from './TransactionListResult.js'
import type { TransactionPatch } from './TransactionPatch.js'
import { TRANSFER_HAS_NO_CATEGORY } from './TRANSFER_HAS_NO_CATEGORY.js'
import type { TransferCreated } from './TransferCreated.js'
import { transferLabels } from './transferLabels.js'

/**
 * Ledger rules: creating, editing, splitting, transferring and categorizing transactions.
 *
 * Services hold business rules. They never write SQL: every read and write goes
 * through the repositories a {@link UnitOfWork} provides, and they throw
 * domain errors (`NotFoundError`, `ConflictError`, `ValidationError`) rather than
 * touching HTTP.
 */
export class TransactionService {
  /** @param uow - Opens transactions and supplies repositories. */
  constructor(protected readonly uow: UnitOfWork) {}

  /**
   * Lists one page of the user's transactions, filtered and sorted, in a total
   * order (the sort column, then the id). Paging is by cursor: each page carries
   * the cursor of the next one, so a page costs the same however deep it is and
   * rows added or removed between requests never repeat or skip a row.
   *
   * @param userId - The signed-in user.
   * @param query - Filters, sort, page size, the cursor to resume after, and whether to count.
   * @returns The page, the cursor of the next page (`null` on the last), and the total if requested.
   * @throws {ValidationError} If the cursor was issued for a different sort or direction.
   */
  async list(userId: string, query: TransactionListQuery): Promise<TransactionListResult> {
    const { sort, direction, limit, cursor, withTotal, ...filters } = query
    if (cursor !== undefined && (cursor.sort !== sort || cursor.direction !== direction)) {
      throw new ValidationError('cursor: It was issued for a different sort order.')
    }

    return this.uow.forUser(
      userId,
      async ({ transactions }) => {
        const page = await transactions.listPage({
          ...filters,
          sort,
          direction,
          limit,
          after: cursor === undefined ? undefined : { value: cursor.value, id: cursor.id },
        })
        const last = page.items.at(-1)
        const nextCursor = page.hasMore && last !== undefined ? cursorAfter(last, sort, direction) : null
        if (!withTotal) return { items: page.items, nextCursor }
        return { items: page.items, nextCursor, total: await transactions.countMatching(filters) }
      },
      { readOnly: true },
    )
  }

  /**
   * Records one transaction. With no explicit category the user's rules are
   * consulted and a match is stored with source `rule`; an explicit category is
   * stored with source `manual` and is never second-guessed by a rule.
   *
   * @param userId - The signed-in user.
   * @param input - The transaction.
   * @returns The created row.
   * @throws {ValidationError} If the input names a transfer account (a transfer is two rows) or a category that is not the user's.
   * @throws {NotFoundError} If the account is not one of the user's.
   * @throws {ConflictError} If the account already has a transaction with the same external id.
   */
  async create(userId: string, input: NewTransaction): Promise<Transaction> {
    if (input.transferAccountId !== undefined && input.transferAccountId !== null) {
      throw new ValidationError(
        'A transfer is two rows, so it has its own endpoint: POST /transactions/transfer ' +
          'with fromAccountId, toAccountId and a positive amount.',
      )
    }

    try {
      return await this.uow.forUser(userId, async ({ transactions, categoryRules }) => {
        const accounts = await transactions.findAccounts([input.accountId])
        if (accounts.length === 0) throw new NotFoundError('Account')
        await assertCategoriesExist(transactions, [input.categoryId])

        let categoryId = input.categoryId ?? null
        let source: 'manual' | 'rule' | null = categoryId === null ? null : 'manual'
        if (categoryId === null) {
          const resolved = resolveCategory(await categoryRules.fetchForMatching(), {
            merchant: input.merchant,
            notes: input.notes,
            amount: input.amount,
          })
          if (resolved !== null) {
            categoryId = resolved
            source = 'rule'
          }
        }

        return transactions.insert({
          userId,
          accountId: input.accountId,
          amount: input.amount,
          merchant: input.merchant,
          transactionDate: input.transactionDate,
          categoryId,
          categorySource: source,
          notes: input.notes ?? null,
          externalId: input.externalId ?? null,
        })
      })
    } catch (error) {
      if (error instanceof DuplicateKeyError) {
        throw new ConflictError(
          'A transaction with that external id already exists on this account.',
          'duplicate_external_id',
        )
      }
      throw error
    }
  }

  /**
   * Moves money between two of the user's accounts as two linked rows: an
   * outgoing (negative) leg on the source and an incoming (positive) leg on the
   * destination, written together and sharing a transfer id.
   *
   * @param userId - The signed-in user.
   * @param input - The transfer; the amount is a positive magnitude.
   * @returns The transfer id and both legs.
   * @throws {ValidationError} If the accounts are the same or the amount is not positive.
   * @throws {NotFoundError} If either account is not one of the user's.
   */
  async createTransfer(userId: string, input: NewTransfer): Promise<TransferCreated> {
    if (input.fromAccountId === input.toAccountId) {
      throw new ValidationError('A transfer needs two different accounts.')
    }
    const amount = money(input.amount)
    if (amount.isZero()) throw new ValidationError('A transfer of nothing is not a transfer.')
    if (amount.isNegative()) {
      throw new ValidationError('Give a positive amount — which account it leaves is what sets the direction.')
    }

    return this.uow.forUser(userId, async ({ transactions }) => {
      const accounts = await transactions.findAccounts([input.fromAccountId, input.toAccountId])
      // Row-level security confines the lookup to the user's own accounts, so a
      // missing one belongs to someone else or does not exist. Both are "not
      // found" from where the caller is standing.
      if (accounts.length !== 2) throw new NotFoundError('Account')
      const nameOf = (id: string): string => accounts.find((a) => a.id === id)?.name ?? 'account'
      const labels = transferLabels(input.description, nameOf(input.fromAccountId), nameOf(input.toAccountId))

      const transferId = randomUUID()
      const notes = input.notes ?? null
      const legs = await transactions.insertTransferLegs([
        {
          userId,
          accountId: input.fromAccountId,
          counterpartAccountId: input.toAccountId,
          amount: negate(input.amount),
          merchant: labels.outgoing,
          transactionDate: input.transactionDate,
          notes,
          transferId,
        },
        {
          userId,
          accountId: input.toAccountId,
          counterpartAccountId: input.fromAccountId,
          amount: input.amount,
          merchant: labels.incoming,
          transactionDate: input.transactionDate,
          notes,
          transferId,
        },
      ])
      return { transferId, legs }
    })
  }

  /**
   * Edits a transaction.
   *
   * A transfer leg cannot gain a category. Amount and date on a transfer leg
   * propagate to its sibling in the same transaction (the sibling gets the
   * negated amount) so the pair always describes one event; a leg's amount must
   * keep its sign, since the sign is the transfer's direction. Both legs are
   * locked in id order. A split transaction's amount cannot be edited, because
   * the parts were validated against it.
   *
   * @param userId - The signed-in user.
   * @param id - The transaction to edit.
   * @param patch - The fields to change.
   * @returns The updated row.
   * @throws {NotFoundError} If the transaction is not the user's.
   * @throws {ValidationError} If the patch names a transfer account, categorizes a transfer leg, names a category that is not the user's, or flips or zeroes a transfer leg's amount.
   * @throws {ConflictError} If the amount of a split transaction would change.
   */
  async update(userId: string, id: string, patch: TransactionPatch): Promise<Transaction> {
    return this.uow.forUser(userId, async ({ transactions }) => {
      const probe = await transactions.findById(id)
      if (probe === undefined) throw new NotFoundError('Transaction')
      assertTransferFlagUntouched(patch)

      const { existing, legs } = await lockForEdit(transactions, probe)

      if (existing.transfer_id !== null && patch.categoryId !== undefined) {
        throw new ValidationError(TRANSFER_HAS_NO_CATEGORY)
      }
      await assertCategoriesExist(transactions, [patch.categoryId])
      assertAmountEditAllowed(existing, patch.amount)

      const updated = await transactions.update(id, buildTransactionChanges(patch))
      if (updated === undefined) throw new NotFoundError('Transaction')

      const siblingChanges = existing.transfer_id === null ? undefined : buildSiblingChanges(patch)
      if (siblingChanges !== undefined) {
        for (const sibling of legs.filter((l) => l.id !== id)) {
          await transactions.update(sibling.id, siblingChanges)
        }
      }
      return updated
    })
  }

  /**
   * Deletes a transaction, or both legs of a transfer: a half-deleted transfer
   * is money that left one account and arrived nowhere. Legs are locked in id
   * order first.
   *
   * @param userId - The signed-in user.
   * @param id - Either leg, or an ordinary transaction.
   * @throws {NotFoundError} If the transaction is not the user's.
   */
  async remove(userId: string, id: string): Promise<void> {
    await this.uow.forUser(userId, async ({ transactions }) => {
      const existing = await transactions.findById(id)
      if (existing === undefined) throw new NotFoundError('Transaction')

      if (existing.transfer_id !== null) {
        await transactions.lockTransferLegs(existing.transfer_id)
        await transactions.deleteTransferLegs(existing.transfer_id)
        return
      }
      if (!(await transactions.delete(id))) throw new NotFoundError('Transaction')
    })
  }

  /**
   * Assigns one category to many transactions, or clears it with `null`. Each
   * assignment is recorded as `manual`, which is what protects it from later
   * rule sweeps.
   *
   * Transfer legs are left alone and counted in `skippedTransfers`. If nothing
   * could be changed because every visible row was a transfer leg, the request
   * is refused, matching an edit of a single leg.
   *
   * @param userId - The signed-in user.
   * @param transactionIds - The transactions to change.
   * @param categoryId - The category to assign, or null to clear.
   * @returns How many rows changed, were requested, and were skipped as transfers.
   * @throws {ValidationError} If the category is not the user's or only transfer legs were selected.
   */
  categorize(userId: string, transactionIds: readonly string[], categoryId: string | null): Promise<CategorizeResult> {
    return this.uow.forUser(userId, async ({ transactions }) => {
      await assertCategoriesExist(transactions, [categoryId])

      const legs = new Set(await transactions.findTransferLegIds(transactionIds))
      const eligible = transactionIds.filter((id) => !legs.has(id))
      // Row-level security silently drops ids belonging to someone else, so the
      // count is what actually changed rather than what was asked for.
      const updated =
        categoryId === null
          ? await transactions.clearCategory(eligible)
          : await transactions.assignCategory(eligible, categoryId, 'manual')

      if (legs.size > 0 && updated === 0) throw new ValidationError(TRANSFER_HAS_NO_CATEGORY)
      return { updated, requested: transactionIds.length, skippedTransfers: legs.size }
    })
  }

  /**
   * @param userId - The signed-in user.
   * @param id - The parent transaction.
   * @returns Its split rows (empty when it is not split).
   * @throws {NotFoundError} If the transaction is not the user's.
   */
  listSplits(userId: string, id: string): Promise<TransactionSplit[]> {
    return this.uow.forUser(
      userId,
      async ({ transactions, splits }) => {
        if ((await transactions.findById(id)) === undefined) throw new NotFoundError('Transaction')
        return splits.listForTransaction(id)
      },
      { readOnly: true },
    )
  }

  /**
   * Replaces a transaction's splits and flags it as split. The parent row is
   * locked, so a concurrent amount edit cannot slip in between the check and
   * the write.
   *
   * @param userId - The signed-in user.
   * @param id - The parent transaction.
   * @param parts - At least two parts, each non-zero, sharing the parent's sign and summing to its amount.
   * @returns The inserted rows.
   * @throws {NotFoundError} If the transaction is not the user's.
   * @throws {ValidationError} If the parent is a transfer leg, the parts have mixed signs or do not total the parent, or a category is not the user's.
   */
  replaceSplits(userId: string, id: string, parts: readonly SplitPart[]): Promise<TransactionSplit[]> {
    return this.uow.forUser(userId, async ({ transactions, splits }) => {
      const parent = await transactions.lockById(id)
      if (parent === undefined) throw new NotFoundError('Transaction')
      if (parent.transfer_id !== null) {
        throw new ValidationError('A transfer is money moving between accounts and cannot be split into categories.')
      }

      assertValidSplits(parent.amount, parts)
      await assertCategoriesExist(transactions, parts.map((p) => p.categoryId))

      const inserted = await splits.replaceForTransaction(
        id,
        parts.map((p) => ({
          userId,
          transactionId: id,
          amount: p.amount,
          categoryId: p.categoryId ?? null,
          notes: p.notes ?? null,
        })),
      )
      await transactions.setSplitFlag(id, true)
      return inserted
    })
  }

  /**
   * Removes all splits from a transaction and clears its split flag, after
   * which its amount can be edited again. Removing splits from a transaction
   * that has none succeeds.
   *
   * @param userId - The signed-in user.
   * @param id - The parent transaction.
   * @throws {NotFoundError} If the transaction is not the user's.
   */
  async removeSplits(userId: string, id: string): Promise<void> {
    await this.uow.forUser(userId, async ({ transactions, splits }) => {
      if ((await transactions.lockById(id)) === undefined) throw new NotFoundError('Transaction')
      await splits.deleteForTransaction(id)
      await transactions.setSplitFlag(id, false)
    })
  }
}
