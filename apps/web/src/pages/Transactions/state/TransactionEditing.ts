import type { FormErrors } from '@wickermoney/ui-kit'
import type { Transaction } from '../../../models/index.js'
import type { TransactionEdit } from './TransactionEdit.js'

/** The table's inline editing state and the actions a row can take. */
export interface TransactionEditing {
  /** The row being edited with its unsaved values, or `null` when none is. */
  readonly editing: TransactionEdit | null
  /**
   * What is wrong with the row being edited: `fields` keyed `merchant`,
   * `notes`, `amount` and `transactionDate`, and `form` for anything else,
   * shown at the end of the row next to its Save button.
   */
  readonly errors: FormErrors
  /** Replaces the unsaved values of the row being edited. */
  readonly change: (next: TransactionEdit) => void
  /** Opens a row for editing amount, merchant, date and notes. */
  readonly start: (transaction: Transaction) => void
  /** Closes the editor without saving. */
  readonly cancel: () => void
  /** Saves the row being edited, then asks the page to re-read its list. */
  readonly save: () => Promise<void>
  /** Confirms with the user, then deletes a transaction (or both legs of a transfer). */
  readonly remove: (transaction: Transaction) => Promise<void>
  /** Assigns one transaction's category inline; an empty string clears it. */
  readonly assign: (id: string, categoryId: string) => Promise<void>
}
