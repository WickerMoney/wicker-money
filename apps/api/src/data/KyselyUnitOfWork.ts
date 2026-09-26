import { asSystem, asUser, type Db, type TransactionOptions } from '../db/client.js'
import { createRepositories } from './createRepositories.js'
import type { Repositories } from './Repositories.js'
import type { UnitOfWork } from './UnitOfWork.js'

/** {@link UnitOfWork} backed by Kysely transactions on the application connection pool. */
export class KyselyUnitOfWork implements UnitOfWork {
  /** @param db - The application database handle (least-privilege role). */
  constructor(private readonly db: Db) {}

  /** @inheritdoc */
  forUser<T>(userId: string, work: (repos: Repositories) => Promise<T>, options?: TransactionOptions): Promise<T> {
    return asUser(this.db, userId, (trx) => work(createRepositories(trx)), options)
  }

  /** @inheritdoc */
  forSystem<T>(work: (repos: Repositories) => Promise<T>, options?: TransactionOptions): Promise<T> {
    return asSystem(this.db, (trx) => work(createRepositories(trx)), options)
  }
}
