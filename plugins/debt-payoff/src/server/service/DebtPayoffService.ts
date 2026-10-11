import { unitsToMoney } from '@wickermoney/plugin-sdk/money'
import { buildPayoffPlan, STRATEGIES, type PayoffPlan, type Strategy } from '../../shared/index.js'
import { MAX_ACTIVE_DEBTS } from '../constants.js'
import type { DebtRepositories } from '../repository/DebtRepositories.js'
import type { DebtRow } from '../repository/DebtRow.js'
import type { DebtUnitOfWork } from '../repository/DebtUnitOfWork.js'
import type { AccountSuggestion } from './AccountSuggestion.js'
import type { Clock } from './Clock.js'
import type { Debt } from './Debt.js'
import { DebtPayoffError } from './DebtPayoffError.js'
import type { DebtChanges, NewDebtInput } from './DebtFields.js'
import { isConstraintError } from './isConstraintError.js'
import type { PlanRequest } from './PlanRequest.js'
import type { Settings, SettingsChanges } from './Settings.js'
import { todayIn } from './todayIn.js'
import { toDebt } from './toDebt.js'

/** The name of the unique index that allows one active debt per account. */
const ONE_PER_ACCOUNT = 'ux_debts_user_account_active'

/** What a person gets before they have saved a choice: the cheapest strategy and no extra. */
const DEFAULT_STRATEGY: Strategy = 'avalanche'
const NO_EXTRA = unitsToMoney(0n)

/** Account types a debt can track. */
const LIABILITY_TYPES: readonly string[] = ['credit_card', 'loan']

/**
 * Debts, the plan settings and the payoff plan.
 *
 * Business rules only: what may be linked, how many debts, what a plan
 * defaults to. SQL lives in the repositories and the arithmetic in the shared
 * strategy module, so this class can be tested with in-memory repositories.
 */
export class DebtPayoffService {
  /**
   * @param uow - Opens a transaction as a user and hands out the repositories.
   * @param now - The current instant; defaults to the real clock.
   */
  constructor(
    private readonly uow: DebtUnitOfWork,
    private readonly now: Clock = () => new Date(),
  ) {}

  /**
   * Lists the user's debts in their own order.
   *
   * @param userId - The signed-in user.
   * @param includeArchived - Whether archived debts are listed too.
   * @returns The debts.
   */
  listDebts(userId: string, includeArchived: boolean): Promise<Debt[]> {
    return this.uow.run(userId, async ({ debts }) => (await debts.list(includeArchived)).map(toDebt))
  }

  /**
   * @param userId - The signed-in user.
   * @param id - The debt's id.
   * @returns The debt.
   * @throws {DebtPayoffError} `404 not_found` if the user has no such debt, which includes another user's.
   */
  getDebt(userId: string, id: string): Promise<Debt> {
    return this.uow.run(userId, async ({ debts }) => {
      const row = await debts.find(id)
      if (row === undefined) throw DebtPayoffError.debtNotFound()
      return toDebt(row)
    })
  }

  /**
   * Adds a debt.
   *
   * @param userId - The signed-in user.
   * @param input - The debt. Amounts are validated decimal strings.
   * @returns The debt as saved.
   * @throws {DebtPayoffError} `400 bad_account` if `accountId` is not one of
   *   the user's loan or credit card accounts, `409 account_already_linked` if
   *   another active debt already tracks it, `409 too_many_debts` at the limit.
   */
  createDebt(userId: string, input: NewDebtInput): Promise<Debt> {
    return this.uow.run(userId, async (repos) => {
      const archived = input.archived ?? false
      if (!archived) await this.requireRoom(repos)
      const accountId = input.accountId ?? null
      if (accountId !== null) await this.requireLinkableAccount(repos, accountId)

      const row = await this.linking(() =>
        repos.debts.insert({
          name: input.name,
          balance: input.balance,
          apr: input.apr,
          minimumPayment: input.minimumPayment,
          accountId,
          sortOrder: input.sortOrder,
          archived,
        }),
      )
      if (row === undefined) throw new DebtPayoffError('The debt could not be saved.', 500, 'not_saved')
      return toDebt(row)
    })
  }

  /**
   * Changes a debt. Fields not sent keep their value; `accountId: null` removes the link.
   *
   * @param userId - The signed-in user.
   * @param id - The debt's id.
   * @param changes - What to change.
   * @returns The debt as saved.
   * @throws {DebtPayoffError} `404 not_found`, and as {@link createDebt} for the account and the limit (the limit applies when un-archiving).
   */
  updateDebt(userId: string, id: string, changes: DebtChanges): Promise<Debt> {
    return this.uow.run(userId, async (repos) => {
      const current = await repos.debts.findForUpdate(id)
      if (current === undefined) throw DebtPayoffError.debtNotFound()

      const accountId = changes.accountId === undefined ? current.account_id : changes.accountId
      const archived = changes.archived ?? current.archived
      if (accountId !== null && accountId !== current.account_id) {
        await this.requireLinkableAccount(repos, accountId)
      }
      if (current.archived && !archived) await this.requireRoom(repos)

      const row = await this.linking(() =>
        repos.debts.replace(id, {
          name: changes.name ?? current.name,
          balance: changes.balance ?? current.balance,
          apr: changes.apr ?? current.apr,
          minimumPayment: changes.minimumPayment ?? current.minimum_payment,
          accountId,
          sortOrder: changes.sortOrder ?? current.sort_order,
          archived,
        }),
      )
      if (row === undefined) throw DebtPayoffError.debtNotFound()
      return toDebt(row)
    })
  }

  /**
   * Deletes a debt.
   *
   * @param userId - The signed-in user.
   * @param id - The debt's id.
   * @returns `{ removed: 1 }`.
   * @throws {DebtPayoffError} `404 not_found` if the user has no such debt.
   */
  deleteDebt(userId: string, id: string): Promise<{ removed: number }> {
    return this.uow.run(userId, async ({ debts }) => {
      const removed = await debts.delete(id)
      if (removed === 0) throw DebtPayoffError.debtNotFound()
      return { removed }
    })
  }

  /**
   * @param userId - The signed-in user.
   * @returns The saved settings, or the defaults (`saved: false`) before any are saved.
   */
  getSettings(userId: string): Promise<Settings> {
    return this.uow.run(userId, ({ settings }) => this.currentSettings(settings))
  }

  /**
   * Saves the plan settings. Fields not sent keep their value.
   *
   * @param userId - The signed-in user.
   * @param changes - What to change.
   * @returns The settings as saved.
   */
  saveSettings(userId: string, changes: SettingsChanges): Promise<Settings> {
    return this.uow.run(userId, async ({ settings }) => {
      const current = await this.currentSettings(settings)
      const saved = await settings.save(
        changes.extraPayment ?? current.extraPayment,
        changes.strategy ?? current.strategy,
      )
      if (saved === undefined) throw new DebtPayoffError('The settings could not be saved.', 500, 'not_saved')
      return { extraPayment: saved.extra_payment, strategy: asStrategy(saved.strategy), saved: true }
    })
  }

  /**
   * Builds the payoff plan for the user's active debts.
   *
   * Two reads at most, in one transaction, however many debts there are: the
   * debts, and the saved settings only when the request leaves out the
   * strategy or the extra.
   *
   * @param userId - The signed-in user.
   * @param request - What the plan is asked for; anything left out comes from the saved settings.
   * @returns The plan, dated from today in the request's time zone.
   */
  getPlan(userId: string, request: PlanRequest): Promise<PayoffPlan> {
    return this.uow.run(userId, async ({ debts, settings }) => {
      const rows = await debts.list(false)
      const needsSettings = request.strategy === undefined || request.extraPayment === undefined
      const saved = needsSettings ? await this.currentSettings(settings) : undefined
      return buildPayoffPlan(
        rows.map(toDebtInput),
        {
          strategy: request.strategy ?? saved?.strategy ?? DEFAULT_STRATEGY,
          extraPayment: request.extraPayment ?? saved?.extraPayment ?? NO_EXTRA,
          startDate: todayIn(request.timezone, this.now()),
        },
      )
    })
  }

  /**
   * Lists the loan and credit card accounts a debt could be started from.
   *
   * @param userId - The signed-in user.
   * @returns Those accounts that are not archived, each with the debt already tracking it, if any.
   */
  listAccountSuggestions(userId: string): Promise<AccountSuggestion[]> {
    return this.uow.run(userId, async ({ accounts }) =>
      (await accounts.listLiabilities()).map((a) => ({
        id: a.id, name: a.name, accountType: a.account_type, debtId: a.debt_id,
      })),
    )
  }

  /** The saved settings, or the defaults. */
  private async currentSettings(settings: DebtRepositories['settings']): Promise<Settings> {
    const row = await settings.get()
    return row === undefined
      ? { extraPayment: NO_EXTRA, strategy: DEFAULT_STRATEGY, saved: false }
      : { extraPayment: row.extra_payment, strategy: asStrategy(row.strategy), saved: true }
  }

  /** Refuses another active debt past {@link MAX_ACTIVE_DEBTS}. */
  private async requireRoom({ debts }: DebtRepositories): Promise<void> {
    if ((await debts.countActive()) >= MAX_ACTIVE_DEBTS) {
      throw new DebtPayoffError(
        `You can have up to ${MAX_ACTIVE_DEBTS} debts that are not archived. Archive one that is paid off to make room.`,
        409,
        'too_many_debts',
      )
    }
  }

  /**
   * Checks that an account is one of the user's own, not archived, and a loan
   * or credit card.
   *
   * The type is checked here rather than by a constraint because an account's
   * type can be changed later and lives in a table the plugin does not own.
   */
  private async requireLinkableAccount({ accounts }: DebtRepositories, accountId: string): Promise<void> {
    const account = await accounts.find(accountId)
    if (account === undefined || account.archived) {
      throw DebtPayoffError.field('accountId', 'Choose one of your loan or credit card accounts.', 'bad_account')
    }
    if (!LIABILITY_TYPES.includes(account.account_type)) {
      throw DebtPayoffError.field('accountId', 'Only a loan or credit card account can be linked.', 'bad_account')
    }
  }

  /** Runs a write and turns the one-debt-per-account violation into its own error. */
  private async linking<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write()
    } catch (error) {
      if (isConstraintError(error, '23505', ONE_PER_ACCOUNT)) {
        throw DebtPayoffError.field('accountId', 'That account already has a debt.', 'account_already_linked', 409)
      }
      throw error
    }
  }
}

/** Narrows a stored strategy, which the database constrains to the two known values. */
function asStrategy(value: string): Strategy {
  const found = STRATEGIES.find((s) => s === value)
  if (found === undefined) throw new Error(`Unknown stored strategy: ${value}`)
  return found
}

/** A debt row as the strategy engine's input. */
function toDebtInput(row: DebtRow) {
  return { id: row.id, name: row.name, balance: row.balance, apr: row.apr, minimumPayment: row.minimum_payment }
}
