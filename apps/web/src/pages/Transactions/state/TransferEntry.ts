import type { FormEvent } from 'react'

/** The transfer form's own fields and its submit action. */
export interface TransferEntry {
  /** The destination account id, or an empty string until one is chosen. */
  readonly toAccountId: string
  /** Chooses the destination account. */
  readonly setToAccountId: (id: string) => void
  /** The positive amount as typed. */
  readonly amount: string
  /** Sets the amount text. */
  readonly setAmount: (amount: string) => void
  /** Records the transfer, then asks the page to re-read its list. */
  readonly submit: (event: FormEvent) => Promise<void>
}
