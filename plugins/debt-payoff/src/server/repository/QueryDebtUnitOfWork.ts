import type { RunAsPlugin } from '@wickermoney/plugin-sdk/server'
import { createDebtRepositories } from './createDebtRepositories.js'
import type { DebtRepositories } from './DebtRepositories.js'
import type { DebtUnitOfWork } from './DebtUnitOfWork.js'

/** {@link DebtUnitOfWork} over the host's `runAsPlugin`. */
export class QueryDebtUnitOfWork implements DebtUnitOfWork {
  /** @param runAsPlugin - The host-supplied transaction runner for this plugin's role. */
  constructor(private readonly runAsPlugin: RunAsPlugin) {}

  /** @inheritdoc */
  run<T>(userId: string, work: (repos: DebtRepositories) => Promise<T>): Promise<T> {
    return this.runAsPlugin(userId, (q) => work(createDebtRepositories(q)))
  }
}
