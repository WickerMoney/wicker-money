import { DuplicateKeyError } from '../../data/DuplicateKeyError.js'
import type { UnitOfWork } from '../../data/UnitOfWork.js'
import type { ReferenceUsage } from '../../db/usage.js'
import { ConflictError, NotFoundError, ValidationError } from '../../errors.js'
import type { AccountChanges } from '../repository/AccountChanges.js'
import type { AccountWithBalance } from '../repository/AccountWithBalance.js'
import { describeAccountUsage } from './describeAccountUsage.js'
import type { HistoryDeletionResult } from './HistoryDeletionResult.js'
import type { InitialBalancePreview } from './InitialBalancePreview.js'
import { loadMigrationPair } from './loadMigrationPair.js'
import type { MigrationConfirmation } from './MigrationConfirmation.js'
import type { MigrationPair } from './MigrationPair.js'
import type { MigrationPlan } from './MigrationPlan.js'
import type { MigrationResult } from './MigrationResult.js'
import type { NewAccount } from './NewAccount.js'
import { planMigration } from './planMigration.js'
import { previewInitialBalanceChange } from './previewInitialBalanceChange.js'
import { spendableChanges, spendableForNew } from './spendable.js'

const SAME_ACCOUNT = 'Choose a different account to move things to.'

/**
 * Account rules: balances, opening-balance fixes, deletion and history migration.
 *
 * Services hold business rules. They never write SQL: every read and write goes
 * through the repositories a {@link UnitOfWork} provides, and they throw
 * domain errors (`NotFoundError`, `ConflictError`, `ValidationError`) rather than
 * touching HTTP.
 */
export class AccountService {
  /** @param uow - Opens transactions and supplies repositories. */
  constructor(protected readonly uow: UnitOfWork) {}

  /**
   * @param userId - The signed-in user.
   * @param includeArchived - Whether archived accounts are included.
   * @returns The user's accounts with derived balances, ordered by name.
   */
  list(userId: string, includeArchived: boolean): Promise<AccountWithBalance[]> {
    return this.uow.forUser(userId, ({ accounts }) => accounts.listWithBalances(includeArchived))
  }

  /**
   * @param userId - The signed-in user.
   * @param id - The account.
   * @returns The account with its derived balance, archived or not.
   * @throws {NotFoundError} If it does not exist.
   */
  async get(userId: string, id: string): Promise<AccountWithBalance> {
    const account = await this.uow.forUser(userId, ({ accounts }) => accounts.findWithBalance(id))
    if (account === undefined) throw new NotFoundError('Account')
    return account
  }

  /**
   * Creates an account owned by the user.
   *
   * @param userId - The signed-in user.
   * @param input - The new account.
   * @returns The created account with its derived balance.
   * @throws {ValidationError} If `spendable` is true for a type that cannot count toward safe to spend.
   */
  async create(userId: string, input: NewAccount): Promise<AccountWithBalance> {
    const spendable = spendableForNew(input.accountType, input.spendable)
    return this.uow.forUser(userId, ({ accounts }) => accounts.insert({ userId, ...input, spendable }))
  }

  /**
   * Edits the fields present in `changes`. The opening balance is not editable
   * here; it has its own preview-then-commit flow.
   *
   * @param userId - The signed-in user.
   * @param id - The account.
   * @param changes - Fields to change.
   * @returns The updated account.
   * @throws {NotFoundError} If it does not exist.
   * @throws {ValidationError} If the edit would make a card, loan or investment account spendable.
   */
  async update(userId: string, id: string, changes: AccountChanges): Promise<AccountWithBalance> {
    const account = await this.uow.forUser(userId, async ({ accounts }) => {
      const current = await accounts.findWithBalance(id)
      if (current === undefined) return undefined
      return accounts.update(id, spendableChanges(current, changes))
    })
    if (account === undefined) throw new NotFoundError('Account')
    return account
  }

  /**
   * Hides an account from the default list while keeping it and its history as they are.
   *
   * @param userId - The signed-in user.
   * @param id - The account.
   * @returns The archived account.
   * @throws {NotFoundError} If it does not exist or is already archived.
   */
  async archive(userId: string, id: string): Promise<AccountWithBalance> {
    const account = await this.uow.forUser(userId, ({ accounts }) => accounts.archive(id))
    if (account === undefined) throw new NotFoundError('Active account')
    return account
  }

  /**
   * Reports what still references an account, so a client can explain why it cannot be deleted.
   *
   * Referencing tables are discovered from the catalog, so plugin tables and
   * both `account_id` and `transfer_account_id` columns are included.
   *
   * @param userId - The signed-in user.
   * @param id - The account.
   * @returns Reference counts with a per-table breakdown.
   * @throws {NotFoundError} If the account does not exist.
   */
  usage(userId: string, id: string): Promise<ReferenceUsage> {
    return this.uow.forUser(userId, async ({ accounts, usage }) => {
      if ((await accounts.findLabel(id)) === undefined) throw new NotFoundError('Account')
      return usage.summarize('core.accounts', '%account_id', id)
    })
  }

  /**
   * Deletes an account that nothing references.
   *
   * Usage is checked up front rather than left to the foreign-key constraint,
   * so the conflict names what is using the account and the alternatives.
   *
   * @param userId - The signed-in user.
   * @param id - The account.
   * @throws {NotFoundError} If it does not exist.
   * @throws {ConflictError} With code `account_in_use` if anything still references it.
   */
  async delete(userId: string, id: string): Promise<void> {
    await this.uow.forUser(userId, async ({ accounts, usage }) => {
      const existing = await accounts.findLabel(id)
      if (existing === undefined) throw new NotFoundError('Account')

      const summary = await usage.summarize('core.accounts', '%account_id', id)
      if (summary.total > 0) {
        throw new ConflictError(
          `'${existing.name}' still has ${describeAccountUsage(summary)}. Archive it to hide it while ` +
            `keeping the history, remove that history with POST /accounts/${id}/delete-with-history, ` +
            `or move it to another account with POST /accounts/${id}/migrate.`,
          'account_in_use',
        )
      }
      await accounts.delete(id)
    })
  }

  /**
   * Deletes an account and every transaction or recurring item that touches it,
   * including the sibling leg of a transfer living on a different account.
   *
   * @param userId - The signed-in user.
   * @param id - The account.
   * @param confirmCount - The usage total the caller saw; a guard against acting on rows that changed since.
   * @returns The deleted account's name and how many rows of each kind were removed.
   * @throws {NotFoundError} If the account does not exist.
   * @throws {ConflictError} With code `usage_changed` if `confirmCount` no longer matches.
   */
  deleteWithHistory(userId: string, id: string, confirmCount: number): Promise<HistoryDeletionResult> {
    return this.uow.forUser(userId, async ({ accounts, usage }) => {
      const existing = await accounts.findLabel(id)
      if (existing === undefined) throw new NotFoundError('Account')

      const summary = await usage.summarize('core.accounts', '%account_id', id)
      if (summary.total !== confirmCount) {
        throw new ConflictError(
          `This account now has ${summary.total} referencing row${summary.total === 1 ? '' : 's'}, not the ` +
            `${confirmCount} you confirmed. Refresh and try again.`,
          'usage_changed',
        )
      }

      const deleted = await accounts.deleteHistory(id)
      await accounts.delete(id)
      return {
        deletedAccount: existing.name,
        deletedTransactions: deleted.transactions,
        deletedRecurringItems: deleted.recurringItems,
      }
    })
  }

  /**
   * Reports what replacing the opening balance would do to the derived balance, without changing anything.
   *
   * @param userId - The signed-in user.
   * @param id - The account.
   * @param newInitialBalance - The proposed opening balance, as a decimal string.
   * @returns Current and proposed opening balance and balance, and the delta.
   * @throws {NotFoundError} If the account does not exist.
   */
  async previewInitialBalance(userId: string, id: string, newInitialBalance: string): Promise<InitialBalancePreview> {
    const account = await this.uow.forUser(userId, ({ accounts }) => accounts.findWithBalance(id))
    if (account === undefined) throw new NotFoundError('Account')
    return previewInitialBalanceChange(account.initial_balance, account.balance, newInitialBalance)
  }

  /**
   * Replaces the opening balance, which shifts every balance the account has ever reported.
   *
   * @param userId - The signed-in user.
   * @param id - The account.
   * @param initialBalance - The new opening balance, as a decimal string.
   * @returns The account with its recomputed balance.
   * @throws {NotFoundError} If the account does not exist.
   */
  async setInitialBalance(userId: string, id: string, initialBalance: string): Promise<AccountWithBalance> {
    const account = await this.uow.forUser(userId, ({ accounts }) => accounts.setInitialBalance(id, initialBalance))
    if (account === undefined) throw new NotFoundError('Account')
    return account
  }

  /**
   * Dry run of a migration: what moving one account's history into another would do.
   *
   * @param userId - The signed-in user.
   * @param fromId - The account whose history would be moved.
   * @param toId - The account that would receive it.
   * @returns Counts of removed and moved rows across transactions and recurring items.
   * @throws {ValidationError} If both ids are the same account or the currencies differ.
   * @throws {NotFoundError} If either account does not exist.
   */
  async previewMigration(userId: string, fromId: string, toId: string): Promise<MigrationPlan> {
    if (fromId === toId) throw new ValidationError(SAME_ACCOUNT)
    return this.uow.forUser(userId, async ({ accounts }) => {
      await loadMigrationPair(accounts, fromId, toId)
      return planMigration(await accounts.countMigrationRows(fromId, toId))
    })
  }

  /**
   * Moves an account's transactions and recurring items to another account,
   * then deletes the now-empty source.
   *
   * Transfers between the two accounts are removed rather than moved, because
   * they would otherwise become transfers from an account to itself.
   *
   * @param userId - The signed-in user.
   * @param fromId - The account whose history is moved and which is then deleted.
   * @param confirmation - The target account and the affected-row count the caller was shown.
   * @returns The plan that was carried out and the name of the receiving account.
   * @throws {ValidationError} If both ids are the same account or the currencies differ.
   * @throws {NotFoundError} If either account does not exist.
   * @throws {ConflictError} With code `usage_changed` if the count no longer matches, or
   *   `external_id_collision` if both accounts hold a transaction with the same external id.
   */
  async migrate(userId: string, fromId: string, confirmation: MigrationConfirmation): Promise<MigrationResult> {
    const { toAccountId, confirmCount } = confirmation
    if (fromId === toAccountId) throw new ValidationError(SAME_ACCOUNT)

    // Filled inside the transaction so the collision message below, raised
    // after the failed transaction has rolled back, can name both accounts.
    const seen: { pair?: MigrationPair } = {}
    try {
      return await this.uow.forUser(userId, async ({ accounts }) => {
        const pair = await loadMigrationPair(accounts, fromId, toAccountId)
        seen.pair = pair

        const plan = planMigration(await accounts.countMigrationRows(fromId, toAccountId))
        if (plan.totalAffected !== confirmCount) {
          throw new ConflictError(
            `This account's history has changed since you last checked (now ${plan.totalAffected} affected ` +
              `row${plan.totalAffected === 1 ? '' : 's'}, not ${confirmCount}). Refresh and try again.`,
            'usage_changed',
          )
        }

        await accounts.moveHistory(fromId, toAccountId)
        await accounts.delete(fromId)
        return { mergedInto: pair.to.name, ...plan }
      })
    } catch (error) {
      if (error instanceof DuplicateKeyError && seen.pair !== undefined) {
        throw new ConflictError(
          `'${seen.pair.from.name}' and '${seen.pair.to.name}' both have a transaction with the same external id, most ` +
            'likely imported from the same source. Resolve that collision by hand before merging.',
          'external_id_collision',
        )
      }
      throw error
    }
  }
}
