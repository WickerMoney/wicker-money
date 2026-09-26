import type { Trx } from '../Trx.js'
import { summarizeUsage, type ReferenceUsage } from '../usage.js'
import type { UsageRepository } from './UsageRepository.js'

/** Kysely implementation of {@link UsageRepository}, reading the `pg_constraint` catalog. */
export class KyselyUsageRepository implements UsageRepository {
  /** @param trx - The transaction all queries run on. */
  constructor(private readonly trx: Trx) {}

  /** @inheritdoc */
  summarize(parentTable: string, columnPattern: string, id: string): Promise<ReferenceUsage> {
    return summarizeUsage(this.trx, parentTable, columnPattern, id)
  }
}
