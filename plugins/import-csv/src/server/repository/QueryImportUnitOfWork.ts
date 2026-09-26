import { createImportRepositories } from './createImportRepositories.js'
import type { ImportRepositories } from './ImportRepositories.js'
import type { ImportUnitOfWork } from './ImportUnitOfWork.js'
import type { RuleLoader } from './RuleLoader.js'
import type { RunAsPlugin } from './RunAsPlugin.js'

/** {@link ImportUnitOfWork} over the host's `runAsPlugin`. */
export class QueryImportUnitOfWork implements ImportUnitOfWork {
  /**
   * @param runAsPlugin - The host-supplied transaction runner for this plugin's role.
   * @param loadRules - The host-supplied category rule loader.
   */
  constructor(
    private readonly runAsPlugin: RunAsPlugin,
    private readonly loadRules: RuleLoader,
  ) {}

  /** @inheritdoc */
  run<T>(userId: string, work: (repos: ImportRepositories) => Promise<T>): Promise<T> {
    return this.runAsPlugin(userId, (q) => work(createImportRepositories(q, this.loadRules)))
  }
}
