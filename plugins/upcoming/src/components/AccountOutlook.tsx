import type { UpcomingAccount } from '../models/index.js'

/** Props for {@link AccountOutlook}. */
export interface AccountOutlookProps {
  readonly accounts: readonly UpcomingAccount[]
  readonly formatMoney: (value: string) => string
  readonly formatDate: (value: string) => string
}

/**
 * Each checking account's lowest point before payday and how much room it
 * leaves above the buffer. One row per account: they are never pooled.
 */
export function AccountOutlook({ accounts, formatMoney, formatDate }: AccountOutlookProps) {
  return (
    <table className="upc-accounts">
      <thead>
        <tr>
          <th scope="col">Checking account</th>
          <th scope="col" className="upc-num">Lowest point</th>
          <th scope="col" className="upc-num">Room above buffer</th>
        </tr>
      </thead>
      <tbody>
        {accounts.map((a) => (
          <tr key={a.accountId} className={a.short ? 'is-short' : undefined}>
            <th scope="row">{a.name}</th>
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
