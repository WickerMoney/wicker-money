import type { FormEvent } from 'react'

/** The spend form's own fields and its submit action. */
export interface SpendEntry {
  /** The signed amount as typed. */
  readonly amount: string
  /** Sets the amount text. */
  readonly setAmount: (amount: string) => void
  /** The chosen category id, or an empty string to let the rules decide. */
  readonly categoryId: string
  /** Chooses the category. */
  readonly setCategoryId: (id: string) => void
  /** Records the transaction, then asks the page to re-read its list. */
  readonly submit: (event: FormEvent) => Promise<void>
}
