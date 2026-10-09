import { isZeroMoney } from '@wickermoney/plugin-sdk/money'
import { Button, Table } from '@wickermoney/ui-kit'
import type { AccountLine } from '../models/index.js'
import { HealthDot } from './HealthDot.js'
import { LineBar } from './LineBar.js'

/** Props for {@link AccountLinesTable}. */
export interface AccountLinesTableProps {
  readonly lines: readonly AccountLine[]
  /** The month being shown, `YYYY-MM`. */
  readonly monthKey: string
  /** Today's date, `YYYY-MM-DD`. */
  readonly today: string
  readonly busy: boolean
  /** Names a category id, for the "not counting" line under an allowance. */
  readonly categoryName: (categoryId: string) => string
  readonly formatMoney: (value: string) => string
  /** Opens the allowance in the form. */
  readonly onEdit: (line: AccountLine) => void
  readonly onRemove: (line: AccountLine) => void
}

/**
 * The month's account allowances: what each has to spend, what has gone, and
 * what is left. Nothing here is edited in place; the form below it is where an
 * allowance's amount, rollover and exclusions change.
 */
export function AccountLinesTable({
  lines, monthKey, today, busy, categoryName, formatMoney: money, onEdit, onRemove,
}: AccountLinesTableProps) {
  return (
    <Table
      columns={[
        {
          key: 'account',
          header: 'Account',
          render: (l: AccountLine) => (
            <span>
              {l.accountName}
              {l.rollover && !isZeroMoney(l.carriedIn) ? (
                <>
                  <br />
                  <span className={`bud__carry${l.carriedIn.startsWith('-') ? ' is-negative' : ''}`}>
                    {l.carriedIn.startsWith('-') ? 'overdrawn ' : 'carried in '}
                    {money(l.carriedIn)}
                  </span>
                </>
              ) : null}
              {l.excludedCategoryIds.length > 0 ? (
                <>
                  <br />
                  <span className="bud__carry">
                    not counting {l.excludedCategoryIds.map(categoryName).join(', ')}
                  </span>
                </>
              ) : null}
            </span>
          ),
        },
        {
          key: 'planned',
          header: 'Allowance',
          numeric: true,
          render: (l: AccountLine) => <span className="bud__num">{money(l.planned)}</span>,
        },
        {
          key: 'spent',
          header: 'Spent',
          numeric: true,
          render: (l: AccountLine) => <span className="bud__num">{money(l.spent)}</span>,
        },
        {
          key: 'left',
          header: 'Left',
          numeric: true,
          render: (l: AccountLine) => <span className="bud__num">{money(l.remaining)}</span>,
        },
        {
          key: 'bar',
          header: 'Pace',
          render: (l: AccountLine) => (
            <LineBar
              used={l.used}
              health={l.health}
              monthKey={monthKey}
              today={today}
              label={`${l.accountName}: ${money(l.spent)} of ${money(l.available)}`}
            />
          ),
        },
        {
          key: 'health',
          header: 'Status',
          render: (l: AccountLine) => <HealthDot health={l.health} />,
        },
        {
          key: 'actions',
          header: '',
          render: (l: AccountLine) => (
            <span className="bud__row-actions">
              <Button disabled={busy} onClick={() => onEdit(l)}>Edit</Button>
              {l.draft ? null : <Button disabled={busy} onClick={() => onRemove(l)}>Remove</Button>}
            </span>
          ),
        },
      ]}
      rows={[...lines]}
      rowKey={(l) => l.accountId}
    />
  )
}
