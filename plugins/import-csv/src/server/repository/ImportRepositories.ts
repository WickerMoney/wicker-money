import type { AccountRepository } from './AccountRepository.js'
import type { BatchLinkRepository } from './BatchLinkRepository.js'
import type { BatchRepository } from './BatchRepository.js'
import type { CategoryRuleRepository } from './CategoryRuleRepository.js'
import type { ImportLockRepository } from './ImportLockRepository.js'
import type { LedgerRepository } from './LedgerRepository.js'
import type { MappingRepository } from './MappingRepository.js'

/** Every repository the import service uses, bound to one transaction. */
export interface ImportRepositories {
  /** Account visibility. */
  readonly accounts: AccountRepository
  /** Per-account import lock. */
  readonly locks: ImportLockRepository
  /** Saved source mappings. */
  readonly mappings: MappingRepository
  /** Import batches. */
  readonly batches: BatchRepository
  /** Batch-to-transaction links. */
  readonly batchLinks: BatchLinkRepository
  /** The ledger's transactions. */
  readonly ledger: LedgerRepository
  /** The user's category rules. */
  readonly categoryRules: CategoryRuleRepository
}
