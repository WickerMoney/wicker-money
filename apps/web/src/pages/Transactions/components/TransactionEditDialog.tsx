import { Button, Dialog, Field, FormError } from '@wickermoney/ui-kit'
import type { TransactionEditing } from '../state/TransactionEditing.js'

/** Props for {@link TransactionEditDialog}. */
export interface TransactionEditDialogProps {
  /** The table's editing state; the dialog is open while a row is being edited. */
  readonly row: TransactionEditing
  /** `true` while a request is in flight; disables Save and Cancel. */
  readonly busy: boolean
}

/**
 * The form for editing one transaction's merchant, amount, date and notes,
 * opened by a row's Edit button.
 *
 * Category is not here: the row's category select saves on change by itself, and
 * a second way to set it could disagree with the first. Enter saves, Escape
 * cancels.
 */
export function TransactionEditDialog({ row, busy }: TransactionEditDialogProps) {
  const { editing, errors } = row
  if (editing === null) return null
  return (
    <Dialog title="Edit transaction" onClose={row.cancel}>
      <form noValidate onSubmit={(e) => { e.preventDefault(); void row.save() }}>
        <Field label="Merchant" required value={editing.merchant} error={errors.fields['merchant']}
               onChange={(e) => row.change({ ...editing, merchant: e.target.value })} />
        <Field label="Amount" inputMode="decimal" required value={editing.amount} error={errors.fields['amount']}
               onChange={(e) => row.change({ ...editing, amount: e.target.value })} />
        {editing.isTransfer ? (
          <p className="form-hint">This is one side of a transfer. Saving also updates the other side.</p>
        ) : null}
        <Field label="Date" type="date" required value={editing.transactionDate}
               error={errors.fields['transactionDate']}
               onChange={(e) => row.change({ ...editing, transactionDate: e.target.value })} />
        <Field label="Notes" placeholder="Optional" value={editing.notes} error={errors.fields['notes']}
               onChange={(e) => row.change({ ...editing, notes: e.target.value })} />
        <FormError message={errors.form} />
        <div className="wm-dialog__actions">
          <Button disabled={busy} onClick={row.cancel}>Cancel</Button>
          <Button
            type="submit" variant="primary"
            disabled={busy || editing.merchant.trim() === '' || editing.amount.trim() === ''}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
