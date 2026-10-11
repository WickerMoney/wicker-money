import type { DebtRepositories } from '../repository/DebtRepositories.js'
import type { DebtUnitOfWork } from '../repository/DebtUnitOfWork.js'
import { InMemoryDebtRepository } from './InMemoryDebtRepository.js'
import type { InMemoryDebtStore } from './InMemoryDebtStore.js'

/**
 * A {@link DebtUnitOfWork} over an {@link InMemoryDebtStore}, for testing the
 * service without a database. It has no transactions: a callback that throws
 * leaves any earlier writes in place. Every repository is scoped to the
 * calling user, as row-level security scopes the real ones.
 */
export class InMemoryDebtUnitOfWork implements DebtUnitOfWork {
  /** @param store - The data every unit of work reads and writes. */
  constructor(private readonly store: InMemoryDebtStore) {}

  /** @inheritdoc */
  run<T>(userId: string, work: (repos: DebtRepositories) => Promise<T>): Promise<T> {
    const store = this.store
    return work({
      debts: new InMemoryDebtRepository(store, userId),
      settings: {
        get: async () => store.settings.get(userId),
        save: async (extraPayment, strategy) => {
          const saved = { extra_payment: extraPayment, strategy }
          store.settings.set(userId, saved)
          return saved
        },
        getForExport: async () => undefined,
      },
      accounts: {
        find: async (id) => {
          const a = store.accounts.find((x) => x.userId === userId && x.id === id)
          return a === undefined ? undefined : { id: a.id, name: a.name, account_type: a.account_type, archived: a.archived }
        },
        listLiabilities: async () =>
          store.accounts
            .filter((a) => a.userId === userId && !a.archived && (a.account_type === 'credit_card' || a.account_type === 'loan'))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((a) => ({
              id: a.id, name: a.name, account_type: a.account_type as 'credit_card' | 'loan',
              debt_id: store.debts.find((d) => d.userId === userId && d.account_id === a.id && !d.archived)?.id ?? null,
            })),
      },
    })
  }
}
