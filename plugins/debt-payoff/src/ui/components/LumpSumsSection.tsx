import { Button, EmptyState, Spinner, Surface, Table, type Column } from '@wickermoney/ui-kit'
import type { LumpSumOutcome } from '../../shared/index.js'
import { lumpSumStatus } from '../helpers/lumpSumStatus.js'
import type { Debt, LumpSum } from '../models/index.js'
import { WhatIfForm, type WhatIfFormProps } from './WhatIfForm.js'

/** Props for {@link LumpSumsSection}. */
export interface LumpSumsSectionProps {
  /** The saved lump sums; `null` while loading. */
  readonly lumpSums: readonly LumpSum[] | null
  /** What the plan did with each, by id; empty before a plan has loaded. */
  readonly outcomes: ReadonlyMap<string, LumpSumOutcome>
  /** The debts that are not archived. */
  readonly debts: readonly Debt[]
  readonly busy: boolean
  readonly formatMoney: (value: string) => string
  readonly formatDate: (value: string) => string
  readonly onAdd: () => void
  readonly onEdit: (lump: LumpSum) => void
  /** Removes a lump sum straight from the list (used for one the plan ignores because its date passed). */
  readonly onRemove: (lump: LumpSum) => void
  readonly onPreview: WhatIfFormProps['onPreview']
  readonly onSaveWhatIf: WhatIfFormProps['onSave']
}

/**
 * The person's one-off payments, what the plan did with each, and the what-if.
 *
 * A lump sum whose date has passed is shown with a note that the plan ignores
 * it, and a button to remove it: the balances already include money paid
 * in the past, so counting it again would be wrong.
 */
export function LumpSumsSection({
  lumpSums, outcomes, debts, busy, formatMoney, formatDate, onAdd, onEdit, onRemove, onPreview, onSaveWhatIf,
}: LumpSumsSectionProps) {
  const names = new Map(debts.map((d) => [d.id, d.name] as const))
  const columns: readonly Column<LumpSum>[] = [
    { key: 'date', header: 'Date', render: (l) => formatDate(l.onDate) },
    {
      key: 'amount',
      header: 'Amount',
      numeric: true,
      render: (l) => formatMoney(l.amount),
    },
    {
      key: 'what',
      header: 'Goes to',
      render: (l) => {
        const parts = l.allocations.map((a) => `${formatMoney(a.amount)} to ${names.get(a.debtId) ?? 'a debt'}`)
        const note = l.note === '' ? '' : `${l.note}. `
        return (
          <span>
            {note}{parts.length === 0 ? 'Follows the strategy.' : `${parts.join(', ')}; the rest follows the strategy.`}
            <span className="dp-sub">{lumpSumStatus(outcomes.get(l.id), formatMoney, formatDate)}</span>
          </span>
        )
      },
    },
    {
      key: 'actions',
      header: '',
      render: (l) => (
        <span className="dp-lump-actions">
          <Button onClick={() => onEdit(l)} aria-label={`Edit the lump sum of ${formatMoney(l.amount)} on ${formatDate(l.onDate)}`}>Edit</Button>
          {outcomes.get(l.id)?.status === 'past' ? (
            <Button
              variant="danger"
              busy={busy}
              onClick={() => onRemove(l)}
              aria-label={`Remove the lump sum of ${formatMoney(l.amount)} on ${formatDate(l.onDate)}`}
            >
              Remove
            </Button>
          ) : null}
        </span>
      ),
    },
  ]
  const past = (lumpSums ?? []).filter((l) => outcomes.get(l.id)?.status === 'past')

  return (
    <Surface title="Lump sums" action={<Button onClick={onAdd}>Add a lump sum</Button>}>
      {lumpSums === null ? <Spinner label="Loading your lump sums" /> : lumpSums.length === 0 ? (
        <EmptyState
          title="No lump sums"
          hint="A bonus, a tax refund or a gift paid toward your debts on one day. Add one, or try the what-if below."
        />
      ) : (
        <>
          {past.length > 0 ? (
            <div className="dp-notice" role="status">
              <p>
                {past.length === 1 ? 'One lump sum has a date that has passed' : `${past.length} lump sums have dates that have passed`}.
                The plan ignores {past.length === 1 ? 'it' : 'them'}, because your balances already include money paid
                before today. Remove {past.length === 1 ? 'it' : 'them'} to tidy the list.
              </p>
            </div>
          ) : null}
          <Table caption="Lump sums" className="dp-debts" columns={columns} rows={lumpSums} rowKey={(l) => l.id} />
        </>
      )}
      <h3 className="dp-h3">What if?</h3>
      <WhatIfForm debts={debts} busy={busy} formatMoney={formatMoney} formatDate={formatDate} onPreview={onPreview} onSave={onSaveWhatIf} />
    </Surface>
  )
}
