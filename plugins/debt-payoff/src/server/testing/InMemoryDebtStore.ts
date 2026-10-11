import type { AccountRow } from '../repository/AccountRow.js'
import type { DebtRow } from '../repository/DebtRow.js'
import type { SettingsRow } from '../repository/SettingsRow.js'

/** A debt in the fake store, with the owner that row-level security would filter on. */
export interface StoredDebt extends DebtRow {
  userId: string
  createdAt: number
}

/** An account in the fake store. */
export interface StoredAccount extends AccountRow {
  userId: string
}

/** The data every {@link InMemoryDebtUnitOfWork} reads and writes. */
export class InMemoryDebtStore {
  readonly debts: StoredDebt[] = []
  readonly accounts: StoredAccount[] = []
  readonly settings = new Map<string, SettingsRow>()
  private nextId = 1
  private clock = 0

  /** @returns A fresh uuid-shaped id. */
  newId(): string {
    return `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, '0')}`
  }

  /** @returns A strictly increasing stamp standing in for `created_at`. */
  tick(): number {
    return ++this.clock
  }
}
