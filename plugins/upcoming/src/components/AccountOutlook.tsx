import { isCounted } from '../helpers/isCounted.js'
import type { UpcomingAccount } from '../models/index.js'

/** Props for {@link AccountOutlook}. */
export interface AccountOutlookProps {
  readonly accounts: readonly UpcomingAccount[]
  readonly formatMoney: (value: string) => string
  readonly formatDate: (value: string) => string
}

/**
 * Each account's lowest point before payday and how much room it leaves above
 * the buffer. One row per account: they are never pooled. An account that does
 * not count toward safe to spend is still listed, muted and labelled, because
 * a bill bouncing there matters either way.
 */
export function AccountOutlook({ accounts, formatMoney, formatDate }: AccountOutlookProps) {
  return (
    <table className="upc-accounts">
      <thead>
        <tr>
          <th scope="col">Account</th>
          <th scope="col" className="upc-num">Lowest point</th>
          <th scope="col" className="upc-num">Room above buffer</th>
        </tr>
      </thead>
      <tbody>
        {accounts.map((a) => (
          <tr key={a.accountId} className={[a.short && 'is-short', !isCounted(a) && 'is-uncounted'].filter(Boolean).join(' ') || undefined}>
            <th scope="row">
              {a.name}
              {isCounted(a) ? null : <span className="upc-tag">not counted</span>}
            </th>
            <td className="upc-num">
              {formatMoney(a.lowest.balance)}
              <span className="upc-muted"> · {formatDate(a.lowest.date)}</span>
            </td>
            <td className={`upc-num ${a.short ? 'upc-neg' : ''}`}>{formatMoney(a.headroom)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
