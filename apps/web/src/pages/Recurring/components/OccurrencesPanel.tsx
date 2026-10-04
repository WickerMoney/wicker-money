import { useState } from 'react'
import {
  Button, Field, FormError, NO_FORM_ERRORS, Spinner, Surface, formErrorsFrom, type FormErrors,
} from '@wickermoney/ui-kit'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import { formatDate } from '../../../lib/formatDate.js'
import { formatMoney } from '../../../lib/formatMoney.js'
import type { RecurringItem, RecurringOccurrence } from '../../../models/index.js'
import { dayDifferenceText, statusLabel } from '../helpers/occurrenceLabels.js'
import {
  overrideDraftFrom, overrideFieldFor, overridePayload, SHARED_AMOUNT, type OverrideDraft,
} from '../helpers/overrideDraft.js'
import { useOccurrences } from '../hooks/useOccurrences.js'

/** Props for {@link OccurrencesPanel}. */
export interface OccurrencesPanelProps {
  readonly item: RecurringItem
  readonly today: string
  readonly currency: string
  readonly accountName: (id: string) => string
  readonly status: ActionStatus
  readonly afterChange: () => Promise<void>
  readonly onClose: () => void
}

/**
 * One item's occurrences around today: which landed (and as what), which are
 * late, and which are still to come. Each can be matched to the transaction
 * that paid it, skipped, moved, or given a different amount, without touching
 * the rest of the series.
 */
export function OccurrencesPanel({ item, today, currency, accountName, status, afterChange, onClose }: OccurrencesPanelProps) {
  const occ = useOccurrences(item, today, status, afterChange)
  const [draft, setDraftState] = useState<OverrideDraft | null>(null)
  // The "Change" form's problems, shown under its fields and beside its Save.
  const [errors, setErrors] = useState<FormErrors>(NO_FORM_ERRORS)
  const busy = status.busy
  const setDraft = (next: OverrideDraft | null) => { setDraftState(next); setErrors(NO_FORM_ERRORS) }

  const save = async (o: RecurringOccurrence) => {
    if (draft === null) return
    const built = overridePayload(item, draft)
    if ('errors' in built) { setErrors(built.errors); return }
    const saved = await occ.record(o, built.payload, (e) => {
      setErrors(formErrorsFrom(e, overrideFieldFor(item), 'Could not save the change.'))
    })
    if (saved) setDraft(null)
  }

  return (
    <Surface title={item.name} action={<Button onClick={onClose}>Back to form</Button>}>
      {!item.tracked ? (
        <p className="wm-muted recur-sub">
          Match a payment to this item and its occurrences start being tracked: one that has not shown up
          is flagged late and still counted as coming, and one that landed early is not counted twice.
        </p>
      ) : null}
      {occ.list === null ? <Spinner /> : occ.list.length === 0 ? (
        <p className="wm-muted">Nothing around today.</p>
      ) : (
        <ol className="recur-occurrences">
          {occ.list.map((o) => {
            const label = statusLabel(o.status, o.kind)
            const open = occ.candidates?.occurrence.nominalDate === o.nominalDate ? occ.candidates : null
            const editing = draft?.nominalDate === o.nominalDate ? draft : null
            const unsettled = o.legs.some((l) => l.transaction === null)
            return (
              <li key={o.nominalDate} className={`recur-occurrence${o.expectedDate === today ? ' is-today' : ''}`}>
                <div className="recur-occurrence__head">
                  <span className="recur-date">{formatDate(o.expectedDate)}</span>
                  <span className={`recur-status recur-status--${label.tone}`}>{label.text}</span>
                  {o.moved ? <span className="wm-muted recur-sub">moved from {formatDate(o.nominalDate)}</span> : null}
                  <span className={`recur-occurrence__amount${o.status === 'skipped' ? ' wm-muted' : ''}`}>
                    {formatMoney(o.amount, currency)}{o.changed ? <span className="wm-muted recur-sub"> changed</span> : null}
                  </span>
                </div>

                {o.status !== 'skipped' ? (
                  <ul className="recur-occurrence__legs">
                    {o.legs.map((l) => (
                      <li key={l.accountId}>
                        <span className="wm-muted">{accountName(l.accountId)}: </span>
                        {l.transaction === null ? <span className="wm-muted">not matched</span> : (
                          <>
                            {l.transaction.merchant}, {formatDate(l.transaction.date)}, {formatMoney(l.transaction.amount, currency)}{' '}
                            <button type="button" className="recur-link" disabled={busy}
                                    onClick={() => void occ.unmatch(o, (l.transaction as { id: string }).id)}>Unmatch</button>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {open !== null ? (
                  <div className="recur-candidates">
                    {open.legs.map((leg) => (
                      <div key={leg.accountId}>
                        <div className="wm-muted recur-sub">
                          {accountName(leg.accountId)}, {formatMoney(leg.amount, currency)} expected:
                        </div>
                        {leg.candidates.length === 0 ? (
                          <p className="wm-muted recur-sub">No transaction on this account within 10 days of {formatDate(o.expectedDate)}.</p>
                        ) : (
                          <ul>
                            {leg.candidates.slice(0, 5).map((c) => (
                              <li key={c.transactionId} className="recur-candidate">
                                <span>
                                  {c.merchant}, {formatDate(c.date)} <span className="wm-muted">({dayDifferenceText(c.dayDifference)})</span>
                                  {c.dismissed === true ? <span className="wm-muted recur-sub"> dismissed</span> : null}
                                </span>
                                <span>{formatMoney(c.amount, currency)}</span>
                                <Button disabled={busy} onClick={() => void occ.match(o, c.transactionId)}>Match</Button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                    <button type="button" className="recur-link" onClick={occ.closeMatches}>Close</button>
                  </div>
                ) : null}

                {editing !== null ? (
                  <form className="recur-override" onSubmit={(e) => { e.preventDefault(); void save(o) }}>
                    <Field label="Expected on" type="date" value={editing.expectedDate}
                           error={errors.fields['expectedDate']}
                           onChange={(e) => setDraft({ ...editing, expectedDate: e.target.value })} />
                    {Object.keys(editing.amounts).map((key) => (
                      <Field key={key} label={key === SHARED_AMOUNT ? 'Amount' : `Amount, ${accountName(key)}`}
                             inputMode="decimal" value={editing.amounts[key] ?? ''} error={errors.fields[key]}
                             onChange={(e) => setDraft({ ...editing, amounts: { ...editing.amounts, [key]: e.target.value } })} />
                    ))}
                    <div className="recur-actions">
                      <Button type="submit" variant="primary" disabled={busy}>Save</Button>
                      <Button disabled={busy} onClick={() => setDraft(null)}>Cancel</Button>
                    </div>
                    <FormError message={errors.form} />
                  </form>
                ) : null}

                <div className="recur-actions recur-occurrence__actions">
                  {o.status === 'skipped' ? (
                    <Button disabled={busy} onClick={() => void occ.record(o, { skipped: false })}>Un-skip</Button>
                  ) : (
                    <>
                      {unsettled && open === null
                        ? <Button disabled={busy} onClick={() => void occ.findMatches(o)}>Find payment</Button>
                        : null}
                      {editing === null && o.status !== 'cleared'
                        ? <Button disabled={busy} onClick={() => setDraft(overrideDraftFrom(item, o))}>Change</Button>
                        : null}
                      {o.legs.every((l) => l.transaction === null)
                        ? <Button disabled={busy} onClick={() => void occ.record(o, { skipped: true })}>Skip</Button>
                        : null}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </Surface>
  )
}
