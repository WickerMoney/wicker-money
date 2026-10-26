import { memo, useEffect, useRef } from 'react'
import { IconButton } from '@wickermoney/ui-kit'
import type { Transaction, TransactionMatchSummary } from '../../../models/index.js'
import { linkButtonId, pickerId } from './linkFocus.js'

/** Props for {@link TransactionActionsCell}. */
export interface TransactionActionsCellProps {
  /** The row. */
  readonly transaction: Transaction
  /** Opens the row in the edit dialog. Must keep its identity between renders. */
  readonly onEdit: (transaction: Transaction) => void
  /** Deletes the row after confirming. Must keep its identity between renders. */
  readonly onDelete: (transaction: Transaction) => Promise<void>
  /** `true` while a request is in flight; disables the buttons. */
  readonly busy: boolean
  /** Recurring matching for the row, if it has any (the Link button's name and highlight). */
  readonly summary?: TransactionMatchSummary | undefined
  /** `true` while this row's picker is open. */
  readonly pickerOpen?: boolean | undefined
  /**
   * Opens the row's picker (`open` is `true`) or closes it. Must keep its identity
   * between renders. Without it there is no Link button: the page has no matching to offer.
   */
  readonly onToggleLink?: ((transaction: Transaction, open: boolean) => void) | undefined
}

/** What the Link button is called: it says what it does and, when there is one, what is suggested. */
function linkLabel(t: Transaction, summary: TransactionMatchSummary | undefined): string {
  if (summary?.linked != null) return `Change recurring item for ${t.merchant} (linked to ${summary.linked.name})`
  const suggestion = summary?.suggestion?.occurrence.name
  return suggestion === undefined
    ? `Link ${t.merchant} to a recurring item`
    : `Link ${t.merchant} to a recurring item (suggestion: ${suggestion})`
}

/**
 * A row's icon buttons: Link, which opens the recurring-item picker under the
 * row (accent colour and a dot when an item is suggested), Edit, which opens the
 * edit dialog, and Delete. Memoized.
 */
export const TransactionActionsCell = memo(function TransactionActionsCell(
  { transaction: t, onEdit, onDelete, busy, summary, pickerOpen = false, onToggleLink }: TransactionActionsCellProps,
) {
  // Focus comes back to Link when the picker closes or the pill is removed and the button that had
  // focus went with it (the page then has none). Not when the user has moved on to another control, and
  // not while the picker is still open: it takes focus itself after Not this, Restore and Unmatch.
  const linked = summary?.linked != null
  const before = useRef({ pickerOpen, linked })
  const wanted = useRef(false)
  useEffect(() => {
    if ((before.current.pickerOpen && !pickerOpen) || (before.current.linked && !linked)) wanted.current = true
    before.current = { pickerOpen, linked }
    if (!wanted.current || busy || pickerOpen) return
    wanted.current = false
    if (document.activeElement === null || document.activeElement === document.body) {
      document.getElementById(linkButtonId(t.id))?.focus()
    }
  })
  const suggest = !linked && summary?.suggestion != null
  return (
    <div className="wm-row-actions">
      {onToggleLink === undefined ? null : (
        <IconButton id={linkButtonId(t.id)} icon="link" label={linkLabel(t, summary)} disabled={busy}
                    className={suggest ? 'recur-linkbtn recur-linkbtn--suggest' : 'recur-linkbtn'}
                    aria-expanded={pickerOpen} aria-controls={pickerId(t.id)}
                    onClick={() => onToggleLink(t, !pickerOpen)} />
      )}
      <IconButton icon="edit" label="Edit" disabled={busy} onClick={() => onEdit(t)} />
      <IconButton icon="delete" label="Delete" variant="danger" disabled={busy} onClick={() => void onDelete(t)} />
    </div>
  )
})
