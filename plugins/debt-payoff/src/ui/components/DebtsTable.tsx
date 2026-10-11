import { memo, useMemo } from 'react'
import { IconButton, Table, type Column } from '@wickermoney/ui-kit'
import type { Debt } from '../models/index.js'

/** Props for {@link DebtsTable}. */
export interface DebtsTableProps {
  readonly debts: readonly Debt[]
  /** Each active debt's chart colour by id. */
  readonly colors: ReadonlyMap<string, string>
  /** The date each debt is paid off in the plan, by id; `null` when it is not within the plan. */
  readonly payoffDates: ReadonlyMap<string, string | null>
  /** The name of each linked account, by account id. */
  readonly accountNames: ReadonlyMap<string, string>
  readonly formatMoney: (value: string) => string
  readonly formatDate: (value: string) => string
  readonly onEdit: (debt: Debt) => void
}

/** A percentage with its trailing zeros trimmed: `24.9900` is `24.99%`. */
function rate(apr: string): string {
  return `${apr.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')}%`
}

/**
 * The person's debts as a table, and as one card per debt on a phone.
 *
 * Wrapped in `memo`: it re-renders only when the debts or the plan's dates
 * change, so typing elsewhere on the page costs it nothing, which matters at the
 * fifty debts the plugin allows. The colour swatch is a second cue next to the
 * name, never the only one.
 */
export const DebtsTable = memo(function DebtsTable({
  debts, colors, payoffDates, accountNames, formatMoney, formatDate, onEdit,
}: DebtsTableProps) {
  const columns = useMemo<readonly Column<Debt>[]>(() => [
    {
      key: 'name',
      header: 'Debt',
      render: (d) => (
        <span className="dp-name">
          <span
            className="dp-swatch"
            aria-hidden="true"
            style={{ background: d.archived ? 'transparent' : (colors.get(d.id) ?? 'var(--wm-chart-other)') }}
          />
          <span>
            {d.name}
            {d.archived ? <span className="dp-tag">Archived</span> : null}
            {d.accountId !== null ? (
              <span className="dp-sub">Linked to {accountNames.get(d.accountId) ?? 'an account'}</span>
            ) : null}
          </span>
        </span>
      ),
    },
    { key: 'balance', header: 'Balance', numeric: true, render: (d) => formatMoney(d.balance) },
    { key: 'apr', header: 'Rate', numeric: true, render: (d) => rate(d.apr) },
    { key: 'minimum', header: 'Minimum', numeric: true, render: (d) => formatMoney(d.minimumPayment) },
    {
      key: 'payoff',
      header: 'Paid off',
      numeric: true,
      render: (d) => {
        if (d.archived) return 'Not in plan'
        const date = payoffDates.get(d.id)
        if (date === undefined) return '…'
        return date === null ? 'Not within the plan' : formatDate(date)
      },
    },
    {
      key: 'actions',
      header: '',
      render: (d) => <IconButton icon="edit" label={`Edit ${d.name}`} onClick={() => onEdit(d)} />,
    },
  ], [colors, payoffDates, accountNames, formatMoney, formatDate, onEdit])

  return <Table columns={columns} rows={debts} rowKey={(d) => d.id} className="dp-debts" caption="Your debts" />
})
