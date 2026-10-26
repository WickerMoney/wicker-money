import { memo, useMemo } from 'react'
import { isZeroMoney } from '@wickermoney/plugin-sdk/money'
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
  /** Whether a change is already being saved; the "In plan" boxes wait for it. */
  readonly busy: boolean
  readonly onEdit: (debt: Debt) => void
  /** Switches a debt into or out of the plan. */
  readonly onToggleIncluded: (debt: Debt, included: boolean) => void
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
  debts, colors, payoffDates, accountNames, formatMoney, formatDate, busy, onEdit, onToggleIncluded,
}: DebtsTableProps) {
  const columns = useMemo<readonly Column<Debt>[]>(() => [
    {
      key: 'name',
      header: 'Debt',
      render: (d) => (
        <span className={d.included || d.archived ? 'dp-name' : 'dp-name dp-name--out'}>
          <span
            className="dp-swatch"
            aria-hidden="true"
            style={{ background: d.archived || !d.included ? 'transparent' : (colors.get(d.id) ?? 'var(--wm-chart-other)') }}
          />
          <span>
            {d.name}
            {d.archived ? <span className="dp-tag">Archived</span> : null}
            {!d.archived && !d.included ? <span className="dp-tag">Not in plan</span> : null}
            {d.accountId !== null ? (
              <span className="dp-sub">Linked to {accountNames.get(d.accountId) ?? 'an account'}</span>
            ) : null}
            {d.repaymentStartsOn !== null ? (
              <span className="dp-sub">Repayment starts {formatDate(d.repaymentStartsOn)}</span>
            ) : null}
            {d.promoApr !== null && d.promoEndsOn !== null ? (
              <span className="dp-sub">
                {rate(d.promoApr)} until {formatDate(d.promoEndsOn)}
                {d.promoDeferredInterest ? ', interest charged back if not paid off' : ''}
              </span>
            ) : null}
            {d.compounding !== 'monthly' ? (
              <span className="dp-sub">{d.compounding === 'daily' ? 'Compounds daily' : 'Simple daily interest'}</span>
            ) : null}
          </span>
        </span>
      ),
    },
    { key: 'balance', header: 'Balance', numeric: true, render: (d) => formatMoney(d.balance) },
    { key: 'apr', header: 'Rate', numeric: true, render: (d) => rate(d.apr) },
    { key: 'minimum', header: 'Minimum', numeric: true, render: (d) => formatMoney(d.minimumPayment) },
    {
      key: 'extra',
      header: 'Extra a month',
      numeric: true,
      render: (d) => {
        if (isZeroMoney(d.extraPayment)) return '—'
        return (
          <>
            {formatMoney(d.extraPayment)}
            {d.archived || !d.included ? <span className="dp-sub">Not used: not in the plan</span> : null}
          </>
        )
      },
    },
    {
      key: 'payoff',
      header: 'Paid off',
      numeric: true,
      render: (d) => {
        if (d.archived || !d.included) return 'Not in plan'
        const date = payoffDates.get(d.id)
        if (date === undefined) return '…'
        return date === null ? 'Not within the plan' : formatDate(date)
      },
    },
    {
      key: 'included',
      header: 'In plan',
      render: (d) => (
        <input
          type="checkbox"
          aria-label={`Include ${d.name} in the payoff plan`}
          checked={d.included && !d.archived}
          disabled={d.archived}
          onChange={(e) => { if (!busy) onToggleIncluded(d, e.target.checked) }}
        />
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (d) => <IconButton icon="edit" label={`Edit ${d.name}`} onClick={() => onEdit(d)} />,
    },
  ], [colors, payoffDates, accountNames, formatMoney, formatDate, busy, onEdit, onToggleIncluded])

  return <Table columns={columns} rows={debts} rowKey={(d) => d.id} className="dp-debts" caption="Your debts" />
})
