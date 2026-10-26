import { useEffect, useRef, type KeyboardEvent } from 'react'
import { Button } from '@wickermoney/ui-kit'
import { formatDate } from '../../../lib/formatDate.js'
import { formatMoney } from '../../../lib/formatMoney.js'
import type { RecurringOccurrence, Transaction, TransactionCandidate } from '../../../models/index.js'
import { dayDifferenceText } from '../../Recurring/helpers/occurrenceLabels.js'
import type { TransactionMatches } from '../hooks/useTransactionMatches.js'
import { pickerId } from './linkFocus.js'

/** Props for {@link TransactionRecurringPicker}. */
export interface TransactionRecurringPickerProps {
  /** The row the picker belongs to. */
  readonly transaction: Transaction
  /** Matching state for the rows on screen; its `picker` is this row's. */
  readonly matches: TransactionMatches
  /** `true` while a request is in flight; disables the buttons. */
  readonly busy: boolean
}

const keyOf = (o: Pick<RecurringOccurrence, 'itemId' | 'nominalDate'>): string => `${o.itemId}:${o.nominalDate}`

/** The first button in a container that can take focus now. */
const firstControl = (root: HTMLElement | null): HTMLElement | null =>
  root?.querySelector<HTMLElement>('button:not(:disabled)') ?? null

/**
 * The recurring items one transaction could settle, in the table row under it
 * (opened by the row's Link button). Suggested first (Match, Not this), then the
 * other items it could be (Match), then those dismissed for it (Restore), then
 * Close. A transaction that already settles an item shows only that item with
 * Unmatch: the API offers nothing else until it is unmatched.
 *
 * Focus moves into the group when it opens, so that Tab continues through the
 * picker and not on to the next row. Escape and Close return it to the row's
 * Link button (see {@link TransactionActionsCell}); Match does too, once the request is done. Not this, Restore and
 * Unmatch keep the picker open with fresh data and put focus on its first
 * control, as the button that was pressed may have gone.
 */
export function TransactionRecurringPicker({ transaction: t, matches, busy }: TransactionRecurringPickerProps) {
  const { picker, byId } = matches
  const summary = byId.get(t.id)
  const root = useRef<HTMLDivElement>(null)
  const refocus = useRef(false)

  useEffect(() => { root.current?.focus() }, [])
  // After an action that keeps the picker open: focus the first control once the data is in and the buttons are enabled.
  useEffect(() => {
    if (busy || !refocus.current) return
    refocus.current = false
    ;(firstControl(root.current) ?? root.current)?.focus()
  }, [busy, picker, summary])

  if (picker === null || picker.transactionId !== t.id) return null

  // Closing the picker (Close, Escape, or Match) unmounts what had focus; the row's Link button takes it back.
  const close = () => matches.closePicker()
  /** An action that leaves the picker open and refreshed. */
  const stay = (work: () => Promise<void>) => () => { refocus.current = true; void work() }
  /** An action that closes the picker. */
  const leave = (work: () => Promise<void>) => () => { void work() }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); close() }
  }

  const linked = summary?.linked ?? picker.linked ?? null
  const suggestion = linked === null ? summary?.suggestion ?? null : null
  const candidates = linked === null ? picker.candidates : []
  const isSuggested = (c: TransactionCandidate) =>
    suggestion !== null && keyOf(c.occurrence) === keyOf(suggestion.occurrence)
  const others = candidates.filter((c) => !c.dismissed && !isSuggested(c))
  const dismissed = new Map<string, RecurringOccurrence>()
  for (const o of summary?.dismissed ?? []) dismissed.set(keyOf(o), o)
  for (const c of candidates) if (c.dismissed) dismissed.set(keyOf(c.occurrence), c.occurrence)
  const nothing = linked === null && suggestion === null && others.length === 0 && dismissed.size === 0

  return (
    <div ref={root} id={pickerId(t.id)} className="recur2__picker" role="group" tabIndex={-1}
         aria-label={`Recurring items for ${t.merchant}`} onKeyDown={onKeyDown}>
      {linked !== null ? (
        <>
          <p className="recur2__section">Linked</p>
          <ul className="recur2__list" aria-label={`Linked to ${t.merchant}`}>
            <li className="recur2__item">
              <span className="recur2__item-text"><strong>{linked.name}</strong>, {formatDate(linked.nominalDate)}</span>
              <span className="recur2__item-actions">
                <Button disabled={busy} aria-label={`Unmatch ${t.merchant} from ${linked.name}`}
                        onClick={stay(() => matches.unmatch(t, linked))}>Unmatch</Button>
              </span>
            </li>
          </ul>
          <p className="wm-muted recur2__empty">Unmatch it to choose a different item.</p>
        </>
      ) : null}

      {suggestion !== null ? (
        <>
          <p className="recur2__section">Suggested</p>
          <ul className="recur2__list" aria-label={`Suggested for ${t.merchant}`}>
            <li className="recur2__item">
              <span className="recur2__item-text">
                <strong>{suggestion.occurrence.name}</strong>, {formatDate(suggestion.occurrence.expectedDate)}
                <span className="wm-muted">
                  {' '}{formatMoney(suggestion.occurrence.legs.find((l) => l.accountId === suggestion.accountId)?.amount ?? suggestion.occurrence.amount)} expected,
                  {' '}{dayDifferenceText(suggestion.candidate.dayDifference)}
                </span>
              </span>
              <span className="recur2__item-actions">
                <Button variant="primary" disabled={busy} aria-label={`Match ${t.merchant} to ${suggestion.occurrence.name}`}
                        onClick={leave(() => matches.confirm(t, suggestion))}>Match</Button>
                <Button disabled={busy} aria-label={`${t.merchant} is not ${suggestion.occurrence.name}`}
                        onClick={stay(() => matches.dismiss(t, suggestion.occurrence))}>Not this</Button>
              </span>
            </li>
          </ul>
        </>
      ) : null}

      {others.length > 0 ? (
        <>
          <p className="recur2__section">{suggestion === null ? 'It could be' : 'Other items it could be'}</p>
          <ul className="recur2__list" aria-label={`Recurring items ${t.merchant} could be`}>
            {others.map((c) => (
              <li key={keyOf(c.occurrence)} className="recur2__item">
                <span className="recur2__item-text">
                  <strong>{c.occurrence.name}</strong>, {formatDate(c.occurrence.expectedDate)}
                  <span className="wm-muted">
                    {' '}{formatMoney(c.occurrence.legs.find((l) => l.accountId === c.accountId)?.amount ?? c.occurrence.amount)} expected,
                    {' '}{dayDifferenceText(c.candidate.dayDifference)}
                  </span>
                </span>
                <span className="recur2__item-actions">
                  <Button disabled={busy} aria-label={`Match to ${c.occurrence.name} ${c.occurrence.nominalDate}`}
                          onClick={leave(() => matches.match(t, c.occurrence))}>Match</Button>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {dismissed.size > 0 ? (
        <>
          <p className="recur2__section">Dismissed for this transaction</p>
          <ul className="recur2__list" aria-label={`Dismissed for ${t.merchant}`}>
            {[...dismissed.values()].map((o) => (
              <li key={keyOf(o)} className="recur2__item">
                <span className="recur2__item-text wm-muted">Not {o.name} ({formatDate(o.nominalDate)})</span>
                <span className="recur2__item-actions">
                  <Button disabled={busy} aria-label={`Restore ${o.name} ${o.nominalDate} as a suggestion for ${t.merchant}`}
                          onClick={stay(() => matches.undismiss(t, o))}>Restore</Button>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {nothing ? (
        <p className="wm-muted recur2__empty">No recurring item expects this within 10 days of {formatDate(t.transaction_date)}.</p>
      ) : null}

      <div className="recur2__footer">
        <Button disabled={busy} onClick={close}>Close</Button>
      </div>
    </div>
  )
}
