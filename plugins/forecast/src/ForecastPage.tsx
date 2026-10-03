import { useState } from 'react'
import type { PluginPageProps } from '@wickermoney/plugin-sdk/runtime'
import { Alert, Button, EmptyState, SelectField, Spinner, Surface } from '@wickermoney/ui-kit'
import { EntryList } from './components/EntryList.js'
import { ForecastChart } from './components/ForecastChart.js'
import { ForecastStatTiles } from './components/ForecastStatTiles.js'
import { HorizonPicker } from './components/HorizonPicker.js'
import { breachMessages } from './helpers/breachMessages.js'
import { HORIZONS } from './helpers/HORIZONS.js'
import { isPositiveAmount } from './helpers/isPositiveAmount.js'
import { useForecast } from './hooks/useForecast.js'
import type { ForecastHorizon } from './models/index.js'
import './styles.js'

/**
 * "Where is each account heading?"
 *
 * One account's balance projected day by day from its recurring items, from
 * today's actual balance through the chosen horizon: a step chart with zero
 * and the account's buffer marked, a banner naming the first day it dips
 * below either, stat tiles, and the list of what moves the line. Every number
 * comes from the server (`GET /core/recurring-items/forecast`), computed
 * against the user's today in their time zone with the same rules as
 * "Until payday"; this page only renders.
 *
 * It projects the schedule, not spending: day-to-day purchases that are not
 * recurring items do not appear, which the page says rather than leaving the
 * line to look more certain than it is.
 *
 * Exposed to the host as a default export.
 */
export default function ForecastPage({ ctx }: PluginPageProps) {
  const [accountId, setAccountId] = useState<string | undefined>(undefined)
  const [horizon, setHorizon] = useState<ForecastHorizon>('90d')
  const { data, loading, error } = useForecast(ctx, accountId, horizon)
  const money = (value: string) => ctx.formatMoney(value)
  const date = (value: string) => ctx.formatDate(value)

  const body = (() => {
    if (data === null) {
      return loading ? <Spinner label="Loading the forecast" /> : null
    }
    if (data.account === null || data.stats === null) {
      return (
        <EmptyState
          title="No accounts yet"
          hint="Add an account to see where its balance is heading."
          action={<Button variant="primary" onClick={() => ctx.navigate('/accounts')}>Add an account</Button>}
        />
      )
    }
    if (!data.hasItems) {
      return (
        <EmptyState
          title="Nothing recurring yet"
          hint="The forecast is built from your recurring income, bills and transfers. Add them and the line follows."
          action={<Button variant="primary" onClick={() => ctx.navigate('/recurring')}>Add recurring items</Button>}
        />
      )
    }

    const { account, stats } = data
    const names = new Map(data.accounts.map((a) => [a.accountId, a.name]))
    const accountName = (id: string) => names.get(id) ?? 'another account'
    const messages = breachMessages(account, stats, data.today, money, date)
    const horizonLabel = HORIZONS.find((h) => h.value === data.horizon)?.label.toLowerCase() ?? ''
    const line = isPositiveAmount(account.buffer) ? `its ${money(account.buffer)} buffer` : 'zero'

    return (
      <>
        {messages.length > 0 ? (
          <div className="fc-alert" role="status">
            {messages.map((m) => <p key={m}>{m}</p>)}
          </div>
        ) : account.cash ? (
          <p className="fc-ok" role="status">
            {account.name} stays above {line} through {date(data.window.through)}.
          </p>
        ) : null}

        <Surface title={`${account.name}, next ${horizonLabel}`}>
          <ForecastChart
            today={data.today}
            start={account.balance}
            days={data.days}
            entries={data.entries}
            buffer={account.buffer}
            cash={account.cash}
            label={`${account.name}: ${money(stats.start)} today, ${money(stats.end)} on ${date(data.window.through)}, lowest ${money(stats.lowest.balance)} on ${date(stats.lowest.date)}.`}
            formatMoney={money}
            formatDate={date}
          />
          <ForecastStatTiles account={account} stats={stats} through={data.window.through} formatMoney={money} formatDate={date} />
          <p className="fc-note">
            Projected from recurring items only. Everyday spending that is not a recurring item is not in this line.
          </p>
        </Surface>

        <Surface title="What moves the line">
          {data.entries.length === 0 ? (
            <p className="fc-note">
              No recurring item touches {account.name} before {date(data.window.through)}, so its balance stays flat.{' '}
              <button type="button" className="fc-link" onClick={() => ctx.navigate('/recurring')}>Add one</button>
            </p>
          ) : (
            <EntryList
              accountId={account.accountId}
              entries={data.entries}
              days={data.days}
              accountName={accountName}
              formatMoney={money}
              formatDate={date}
            />
          )}
        </Surface>
      </>
    )
  })()

  return (
    <div className="page fc">
      <h1 className="page__title">Forecast</h1>
      <div className="fc-controls">
        {data !== null && data.accounts.length > 0 ? (
          <SelectField
            label="Account"
            value={data.account?.accountId ?? ''}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {data.accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}
          </SelectField>
        ) : null}
        <HorizonPicker value={horizon} onChange={setHorizon} />
        {loading && data !== null ? <span className="fc-muted" role="status">Updating…</span> : null}
      </div>
      {error !== null ? <Alert>{error}</Alert> : null}
      {body}
    </div>
  )
}
