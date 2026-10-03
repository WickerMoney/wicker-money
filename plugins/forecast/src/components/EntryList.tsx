import { counterpart } from '../helpers/counterpart.js'
import type { ForecastDay, ForecastEntry } from '../models/index.js'

/** Props for {@link EntryList}. */
export interface EntryListProps {
  readonly accountId: string
  readonly entries: readonly ForecastEntry[]
  /** The projected days, to show the balance each entry leaves behind. */
  readonly days: readonly ForecastDay[]
  readonly accountName: (id: string) => string
  readonly formatMoney: (value: string) => string
  readonly formatDate: (value: string) => string
}

/**
 * What moves the line, in date order, with the balance at the end of each
 * day. Money in is green and money out red, except transfers between the
 * user's own accounts, which stay neutral with their direction spelled out:
 * moving money to savings is neither earned nor spent.
 *
 * An occurrence that already arrived stays listed, tagged and with no
 * amount, since it no longer moves the line; a late one is tagged on the
 * day it is now expected.
 */
export function EntryList({ accountId, entries, days, accountName, formatMoney, formatDate }: EntryListProps) {
  const endOf = new Map(days.map((d) => [d.date, d.balance]))
  return (
    <table className="fc-entries">
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Item</th>
          <th scope="col" className="fc-num">Amount</th>
          <th scope="col" className="fc-num">End of day</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e, i) => {
          const tone = e.kind === 'transfer' ? '' : e.amount.startsWith('-') ? 'fc-neg' : 'fc-pos'
          const lastOfDay = entries[i + 1]?.date !== e.date
          const other = counterpart(e, accountId, accountName)
          return (
            <tr key={`${e.itemId}:${e.nominalDate ?? e.date}`}>
              <td className="fc-date">{formatDate(e.date)}</td>
              <th scope="row">
                {e.name}
                {other !== '' ? <span className="fc-muted"> {other}</span> : null}
                {e.status === 'cleared' ? <span className="fc-tag">Arrived</span> : null}
                {e.status === 'late' || e.status === 'due'
                  ? <span className="fc-tag fc-tag--warn">{e.status === 'late' ? `Late, due ${formatDate(e.nominalDate ?? e.date)}` : 'Not in yet'}</span>
                  : null}
              </th>
              <td className={`fc-num ${e.status === 'cleared' ? 'fc-muted' : tone}`}>
                {e.status === 'cleared' ? '—' : formatMoney(e.amount)}
              </td>
              <td className="fc-num">{lastOfDay ? formatMoney(endOf.get(e.date) ?? '0') : ''}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
