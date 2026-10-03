import { useMemo, useState, type FormEvent } from 'react'
import { Alert, Button, SelectField, Surface } from '@wickermoney/ui-kit'
import { useAuth } from '../../../auth/index.js'
import { browserTimezone } from '../../../lib/browserTimezone.js'
import { timezoneOptions } from '../../../lib/timezoneOptions.js'

/**
 * The account's time zone, which decides where its days and months end:
 * "today" on the Recurring page, the "Until payday" widget and the forecast,
 * and the month boundaries reports use.
 *
 * It is stored on the server, not in the browser, because those answers are
 * worked out on the server and have to agree on every device. When it differs
 * from the browser's own zone (an account from before the zone was set at
 * sign-up is still on `UTC`), the section says so and offers a one-click fix.
 */
export function TimezoneSection() {
  const { user, setTimezone } = useAuth()
  const current = user?.timezone ?? 'UTC'
  const browser = browserTimezone()
  const zones = useMemo(() => timezoneOptions(current), [current])
  const [choice, setChoice] = useState(current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const save = async (zone: string) => {
    setBusy(true); setError(null); setSaved(false)
    try {
      await setTimezone(zone)
      setChoice(zone)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the time zone.')
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void save(choice)
  }

  const mismatch = browser !== undefined && browser !== current

  return (
    <Surface title="Time zone">
      <p className="form-hint" style={{ margin: '0 0 10px' }}>
        Decides when your day rolls over: what counts as today on the Recurring page, in
        &ldquo;Until payday&rdquo; and in the forecast, and where each month starts in reports.
      </p>
      {mismatch ? (
        <p className="tz-mismatch" role="status">
          <span>
            This browser is on <strong>{browser.replaceAll('_', ' ')}</strong>, but your account
            uses <strong>{current.replaceAll('_', ' ')}</strong>.
          </span>
          <Button onClick={() => { void save(browser) }} disabled={busy}>Use {browser.replaceAll('_', ' ')}</Button>
        </p>
      ) : null}
      {error !== null ? <Alert>{error}</Alert> : null}
      <form className="tz-form" onSubmit={onSubmit}>
        <SelectField
          label="Time zone"
          value={choice}
          onChange={(e) => { setChoice(e.target.value); setSaved(false) }}
          disabled={busy}
        >
          {zones.map((z) => <option key={z} value={z}>{z.replaceAll('_', ' ')}</option>)}
        </SelectField>
        <Button type="submit" variant="primary" disabled={busy || choice === current}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {saved && choice === current ? <span className="wm-muted" role="status">Saved.</span> : null}
      </form>
    </Surface>
  )
}
