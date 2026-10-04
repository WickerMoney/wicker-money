import type { FormErrors } from '@wickermoney/ui-kit'
import type { Account } from '../../../models/index.js'
import type { AccountEdit } from './AccountEdit.js'

/** The accounts table's inline editing state and the actions a row can take. */
export interface AccountEditing {
  /** The row being edited with its unsaved values, or `null` when none is. */
  readonly editing: AccountEdit | null
  /**
   * What is wrong with the row being edited: `fields` keyed `name`,
   * `currencyCode` and `bufferAmount`, and anything else beside its Save
   * button.
   */
  readonly errors: FormErrors
  /** Replaces the unsaved values of the row being edited. */
  readonly change: (next: AccountEdit) => void
  /** Opens a row for editing its name, type, currency and buffer. */
  readonly start: (account: Account) => void
  /** Closes the editor without saving. */
  readonly cancel: () => void
  /** Saves the row being edited, then asks the page to re-read its list. */
  readonly save: () => Promise<void>
  /** Saves whether an account counts toward safe to spend, straight away, then re-reads the list. */
  readonly setSpendable: (account: Account, spendable: boolean) => Promise<void>
}
