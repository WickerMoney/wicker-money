import { useState } from 'react'
import { Button, Stat, Surface } from '@wickermoney/ui-kit'
import type { AnalyzeResult } from '../models/index.js'
import { REVIEW_PAGE_SIZE } from './REVIEW_PAGE_SIZE.js'

/** Props for {@link ReviewStep}. */
export interface ReviewStepProps {
  readonly analysis: AnalyzeResult
  readonly accepted: ReadonlySet<number>
  readonly onAccepted: (next: ReadonlySet<number>) => void
  readonly formatMoney: (value: string) => string
  readonly busy: boolean
  readonly onCommit: () => void
}

/**
 * Shows what committing the file will do, before it does it.
 *
 * Rows matched on the source's transaction id are stated as skipped and not
 * offered: the source said they are the same transaction, so there is nothing to
 * decide. Rows matched only by the amount, description and date heuristic are a
 * guess, so each is listed beside the transaction it matched and imported only if
 * ticked. Dropping both kinds silently would let a second identical coffee vanish
 * with no record that it ever existed.
 *
 * A file can flag thousands of rows, so the list shows one page at a time; rows
 * beyond it are still imported only if ticked, and the count says how many are
 * hidden.
 */
export function ReviewStep({
  analysis, accepted, onAccepted, formatMoney, busy, onCommit,
}: ReviewStepProps) {
  const { summary, rows } = analysis
  const flagged = rows.filter((r) => r.status === 'needs-review')
  const [shown, setShown] = useState(REVIEW_PAGE_SIZE)
  const visible = flagged.slice(0, shown)
  const willImport = summary.new + accepted.size

  const toggle = (rowNumber: number) => {
    const next = new Set(accepted)
    if (next.has(rowNumber)) next.delete(rowNumber)
    else next.add(rowNumber)
    onAccepted(next)
  }

  return (
    <Surface title="3 · Review">
      <div className="imp__stats">
        <Stat label="New" value={String(summary.new)} />
        <Stat label="Already imported" value={String(summary.duplicate)} />
        <Stat label="Needs review" value={String(summary.needsReview)} />
        {summary.errors > 0 ? <Stat label="Unreadable" value={String(summary.errors)} /> : null}
      </div>

      {summary.duplicate > 0 ? (
        <p className="imp__hint">
          {summary.duplicate} row{summary.duplicate === 1 ? '' : 's'} matched a transaction ID
          already in this account and will be skipped. That match is exact, not a guess.
        </p>
      ) : null}

      {flagged.length > 0 ? (
        <>
          <h3 className="imp__subhead">
            Possible duplicates — tick any that are genuinely new
          </h3>
          <table className="imp__table">
            <thead>
              <tr>
                <th>Import</th><th>Row</th><th>Date</th><th>Description</th>
                <th className="num">Amount</th><th>Matches</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.rowNumber}>
                  <td>
                    <input
                      type="checkbox"
                      checked={accepted.has(r.rowNumber)}
                      onChange={() => toggle(r.rowNumber)}
                      aria-label={`Import row ${r.rowNumber}: ${r.merchant}`}
                    />
                  </td>
                  <td className="imp__muted">{r.rowNumber}</td>
                  <td>{r.date}</td>
                  <td>{r.merchant}</td>
                  <td className={`num ${r.amount.startsWith('-') ? 'imp__out' : 'imp__in'}`}>
                    {formatMoney(r.amount)}
                  </td>
                  <td className="imp__muted">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {flagged.length > visible.length ? (
            <div className="imp__actions">
              <Button onClick={() => setShown((n) => n + REVIEW_PAGE_SIZE)}>
                Show {Math.min(REVIEW_PAGE_SIZE, flagged.length - visible.length)} more
              </Button>
              <span className="imp__hint">
                Showing {visible.length} of {flagged.length} possible duplicates.
              </span>
            </div>
          ) : null}
        </>
      ) : null}

      <div className="imp__actions">
        <Button variant="primary" disabled={busy || willImport === 0} onClick={onCommit}>
          {busy ? 'Importing…' : `Import ${willImport} transaction${willImport === 1 ? '' : 's'}`}
        </Button>
        {willImport === 0 ? (
          <span className="imp__hint">Nothing new to import from this file.</span>
        ) : null}
      </div>
    </Surface>
  )
}
