import type { FormEvent, RefObject } from 'react'
import type { FormErrors } from '@wickermoney/ui-kit'

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
  /**
   * What is wrong, by field (`fromAccountId`, `toAccountId`, `amount`,
   * `transactionDate`, `description`), and anything else for beside the button.
   */
  readonly errors: FormErrors
  /** Attach to the `<form>`, so focus can move to the first problem. */
  readonly formRef: RefObject<HTMLFormElement | null>
  /** Records the transfer, then asks the page to re-read its list. */
  readonly submit: (event: FormEvent) => Promise<void>
}
