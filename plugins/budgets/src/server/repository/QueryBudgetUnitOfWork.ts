import type { BudgetRepositories } from './BudgetRepositories.js'
import type { BudgetUnitOfWork } from './BudgetUnitOfWork.js'
import { createBudgetRepositories } from './createBudgetRepositories.js'
import type { RunAsPlugin } from './RunAsPlugin.js'

/** {@link BudgetUnitOfWork} over the host's `runAsPlugin`. */
export class QueryBudgetUnitOfWork implements BudgetUnitOfWork {
  /** @param runAsPlugin - The host-supplied transaction runner for this plugin's role. */
  constructor(private readonly runAsPlugin: RunAsPlugin) {}

  /** @inheritdoc */
  run<T>(userId: string, work: (repos: BudgetRepositories) => Promise<T>): Promise<T> {
    return this.runAsPlugin(userId, (q) => work(createBudgetRepositories(q)))
  }
}
