import type { Repositories } from '../../../data/Repositories.js'
import type { UnitOfWork } from '../../../data/UnitOfWork.js'
import type { MonthlyTotalRow } from '../../repository/MonthlyTotalRow.js'
import type { ReportRepository } from '../../repository/ReportRepository.js'

/**
 * A {@link UnitOfWork} whose report repository returns canned data and
 * records what it was asked for. Only `reports` exists; touching any other
 * repository fails the test loudly.
 */
export class InMemoryReportUnitOfWork implements UnitOfWork {
  /** Time zone returned for every user; `undefined` simulates a missing user. */
  timezone: string | undefined = 'UTC'

  /** Rows returned by the monthly totals query. */
  totals: MonthlyTotalRow[] = []

  /** The `since` argument of every monthly totals query, in order. */
  readonly sinceRequested: string[] = []

  private readonly reports: ReportRepository = {
    findTimezone: async () => this.timezone,
    countActiveAccounts: async () => 0,
    listActiveAccounts: async () => [],
    listEnabledCategories: async () => [],
    monthlyTotals: async (since) => {
      this.sinceRequested.push(since)
      return this.totals
    },
  }

  /** @inheritdoc */
  forUser<T>(_userId: string, work: (repos: Repositories) => Promise<T>): Promise<T> {
    return work({ reports: this.reports } as Partial<Repositories> as Repositories)
  }

  /** @inheritdoc */
  forSystem<T>(): Promise<T> {
    return Promise.reject(new Error('forSystem is not used by reports.'))
  }
}
