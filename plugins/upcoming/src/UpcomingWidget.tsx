import { useState } from 'react'
import type { PluginWidgetProps } from '@wickermoney/plugin-sdk/runtime'
import { Alert, Button, EmptyState, Spinner } from '@wickermoney/ui-kit'
import { AccountOutlook } from './components/AccountOutlook.js'
import { isCounted } from './helpers/isCounted.js'
import { UpcomingList } from './components/UpcomingList.js'
import { shortfallText } from './helpers/shortfallText.js'
import { useUpcoming } from './hooks/useUpcoming.js'
import './styles.js'

/**
 * "Will I make it to payday?"
 *
 * Shows what is safe to spend until the household's next payday, which
 * account (if any) dips below its buffer and when, and what lands in between.
 * Which accounts count toward the headline is the user's choice, made per
 * account on the Accounts page (`spendable`): a second checking account kept
 * for yearly bills, or a large savings balance, can be listed without being
 * offered as spending money. Every number is computed on the server against the user's today
 * (see `GET /core/recurring-items/upcoming`); this widget only renders.
 *
 * The window is payday-driven, not the dashboard's range: the question is
 * "until the next paycheck", whatever period the charts beside it show.
 *
 * States: loading, error, no recurring items, and the outlook itself — with a
 * shortfall banner when an account comes up short, and a 14-day window when no
 * income is expected. Transfers always count in the balances; the toggle only
 * decides whether they are listed.
 *
 * Exposed to the host as a default export.
 */
export default function UpcomingWidget({ ctx }: PluginWidgetProps) {
  const { data, accountNames, loading, error } = useUpcoming(ctx)
  const [showTransfers, setShowTransfers] = useState(false)
  const money = (value: string) => ctx.formatMoney(value)
  const date = (value: string) => ctx.formatDate(value)
  const accountName = (id: string) => accountNames.get(id) ?? 'Unknown account'

  if (loading) return <Spinner label="Loading what is coming up" />
  if (error !== null) return <Alert>{error}</Alert>
  if (data === null || !data.hasItems) {
    return (
      <div className="upc upc--empty">
        <EmptyState
          title="Nothing recurring yet"
          hint="Add your paychecks and bills to see what is safe to spend until payday."
        />
        <div className="upc-center">
          <Button variant="primary" onClick={() => ctx.navigate('/recurring')}>Add recurring items</Button>
        </div>
      </div>
    )
  }

  const short = data.accounts.filter((a) => a.short)
  const counted = data.accounts.filter(isCounted)
  const chooseAccounts = (
    <button type="button" className="upc-link" onClick={() => ctx.navigate('/accounts')}>Choose accounts</button>
  )
  const listed = showTransfers ? data.occurrences : data.occurrences.filter((o) => o.kind !== 'transfer')
  const until = data.window.payday === null
    ? `through ${date(data.window.through)}`
    : `until payday, ${date(data.window.payday)}`

  return (
    <div className="upc">
      <div className="upc-head">
        <div className="upc-head__label">Safe to spend {until}</div>
        <div className={`upc-head__value ${short.length > 0 ? 'upc-warn' : ''}`}>{money(data.safeToSpend)}</div>
        {data.window.payday === null ? (
          <p className="upc-note">No income expected soon, so this looks two weeks ahead.</p>
        ) : null}
        {data.accounts.length > 0 ? (
          <p className="upc-note">
            {counted.length === 0
              ? 'No account counts toward safe to spend yet. '
              : `Counting ${counted.map((a) => a.name).join(', ')}. `}
            {chooseAccounts}
          </p>
        ) : null}
      </div>

      {short.length > 0 ? (
        <div className="upc-alerts" role="status">
          {short.map((a) => (
            <p key={a.accountId} className="upc-alert">{shortfallText(a, money, date)}</p>
          ))}
          <p className="upc-note">A short account is not covered by another account's surplus.</p>
        </div>
      ) : null}

      {data.accounts.length > 0 ? (
        <AccountOutlook accounts={data.accounts} formatMoney={money} formatDate={date} />
      ) : (
        <p className="upc-note">Add a checking account, or mark a savings account as spendable, to see what is safe to spend. {chooseAccounts}</p>
      )}

      <div className="upc-section">
        <div className="upc-section__head">
          <h3 className="upc-section__title">Coming up</h3>
          <label className="upc-toggle">
            <input type="checkbox" checked={showTransfers} onChange={(e) => setShowTransfers(e.target.checked)} />
            <span>Show transfers</span>
          </label>
        </div>
        {listed.length === 0 ? (
          <p className="upc-note">Nothing due before then.</p>
        ) : (
          <UpcomingList occurrences={listed} accountName={accountName} formatMoney={money} formatDate={date} />
        )}
      </div>
    </div>
  )
}
