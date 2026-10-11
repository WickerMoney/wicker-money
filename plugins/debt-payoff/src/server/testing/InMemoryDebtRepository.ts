import type { DebtRepository } from '../repository/DebtRepository.js'
import type { DebtRow } from '../repository/DebtRow.js'
import type { ExportedDebt } from '../repository/ExportedDebt.js'
import type { NewDebt } from '../repository/NewDebt.js'
import type { InMemoryDebtStore, StoredDebt } from './InMemoryDebtStore.js'

/** The unique-index violation PostgreSQL raises for a second active debt on one account. */
class AccountTakenError extends Error {
  readonly code = '23505'
  readonly constraint = 'ux_debts_user_account_active'
}

const row = (d: StoredDebt): DebtRow => ({
  id: d.id, name: d.name, balance: d.balance, apr: d.apr, minimum_payment: d.minimum_payment,
  account_id: d.account_id, sort_order: d.sort_order, archived: d.archived,
})

/** {@link DebtRepository} over an {@link InMemoryDebtStore}, scoped to one user the way row-level security is. */
export class InMemoryDebtRepository implements DebtRepository {
  constructor(private readonly store: InMemoryDebtStore, private readonly userId: string) {}

  private mine(): StoredDebt[] {
    return this.store.debts.filter((d) => d.userId === this.userId)
  }

  async list(includeArchived: boolean): Promise<DebtRow[]> {
    return this.mine()
      .filter((d) => includeArchived || !d.archived)
      .sort((a, b) => a.sort_order - b.sort_order || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map(row)
  }

  async find(id: string): Promise<DebtRow | undefined> {
    const found = this.mine().find((d) => d.id === id)
    return found === undefined ? undefined : row(found)
  }

  findForUpdate(id: string): Promise<DebtRow | undefined> {
    return this.find(id)
  }

  async countActive(): Promise<number> {
    return this.mine().filter((d) => !d.archived).length
  }

  async insert(debt: NewDebt): Promise<DebtRow | undefined> {
    this.requireFreeAccount(debt.accountId, debt.archived, undefined)
    const last = this.mine().reduce((max, d) => Math.max(max, d.sort_order), -1)
    const stored: StoredDebt = {
      id: this.store.newId(), userId: this.userId, createdAt: this.store.tick(),
      name: debt.name, balance: debt.balance, apr: debt.apr, minimum_payment: debt.minimumPayment,
      account_id: debt.accountId, sort_order: debt.sortOrder ?? last + 1, archived: debt.archived,
    }
    this.store.debts.push(stored)
    return row(stored)
  }

  async replace(
    id: string,
    debt: Omit<NewDebt, 'sortOrder'> & { readonly sortOrder: number },
  ): Promise<DebtRow | undefined> {
    const found = this.mine().find((d) => d.id === id)
    if (found === undefined) return undefined
    this.requireFreeAccount(debt.accountId, debt.archived, id)
    Object.assign(found, {
      name: debt.name, balance: debt.balance, apr: debt.apr, minimum_payment: debt.minimumPayment,
      account_id: debt.accountId, sort_order: debt.sortOrder, archived: debt.archived,
    })
    return row(found)
  }

  async delete(id: string): Promise<number> {
    const at = this.store.debts.findIndex((d) => d.userId === this.userId && d.id === id)
    if (at < 0) return 0
    this.store.debts.splice(at, 1)
    return 1
  }

  async listAll(): Promise<ExportedDebt[]> {
    const now = new Date(0)
    return (await this.list(true)).map((d) => ({ ...d, created_at: now, updated_at: now }))
  }

  /** Emulates the partial unique index: one active debt per account per user. */
  private requireFreeAccount(accountId: string | null, archived: boolean, exceptId: string | undefined): void {
    if (accountId === null || archived) return
    const taken = this.mine().some((d) => d.account_id === accountId && !d.archived && d.id !== exceptId)
    if (taken) throw new AccountTakenError('duplicate key value violates unique constraint')
  }
}
