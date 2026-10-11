import { useState } from 'react'
import { Alert, Spinner } from '@wickermoney/ui-kit'
import { ApiError } from '../../../api/ApiError.js'
import { api } from '../../../api/client.js'
import { useAuth } from '../../../auth/index.js'
import { ERASE_PHRASES } from '../helpers/ERASE_PHRASES.js'
import { describeBlocker } from '../helpers/describeBlocker.js'
import { useInstanceEraseCheck } from '../hooks/useInstanceEraseCheck.js'
import { EraseDialog } from './EraseDialog.js'
import { ExportFirst } from './ExportFirst.js'

/** Props for {@link EraseInstanceDialog}. */
export interface EraseInstanceDialogProps {
  /** Closes the dialog without erasing. */
  readonly onClose: () => void
}

/** "3 other sessions (2 other people)". */
function describeActivity(sessions: number, people: number): string {
  const s = `${sessions} other ${sessions === 1 ? 'session' : 'sessions'}`
  if (people === 0) return `${s}, all on your own account`
  return `${s} (${people} other ${people === 1 ? 'person' : 'people'})`
}

/**
 * Confirmation for "Erase this entire instance" (owner only): deletes every
 * account and every plugin's data and signs everyone out.
 *
 * What it will do is read from the server first: which database, who else is
 * signed in, and whether the instance could register a new owner afterwards. A
 * blocker disables the button; other live sessions need an explicit tick.
 */
export function EraseInstanceDialog({ onClose }: EraseInstanceDialogProps) {
  const { signOut } = useAuth()
  const { check, error, reload } = useInstanceEraseCheck()
  const [acknowledged, setAcknowledged] = useState(false)

  const blocker = check === null ? null : describeBlocker(check)
  const others = check !== null && check.otherSessions > 0
  const ready = check !== null && blocker === null && (!others || acknowledged)

  const submit = async (input: { password: string; confirmation: string }) => {
    try {
      await api.post('/settings/erase-instance', { ...input, acknowledgeActiveSessions: acknowledged })
    } catch (e) {
      // Someone signed in since the preflight: show the new count and ask again.
      if (e instanceof ApiError && e.code === 'active_sessions') { setAcknowledged(false); reload() }
      throw e
    }
  }

  return (
    <EraseDialog
      title="Erase this entire instance"
      phrase={ERASE_PHRASES.instance}
      confirmLabel="Erase this instance"
      onClose={onClose}
      submit={submit}
      onErased={signOut}
      ready={ready}
    >
      <p>
        This permanently deletes <strong>every account</strong> on this instance and everything in
        it: all accounts, transactions, categories, rules, recurring items, and every
        plugin&rsquo;s data, for everyone. Everyone is signed out. Afterwards the instance is empty,
        and the first person to register becomes its owner. Which plugins are switched on is kept.
      </p>
      {error !== null ? <Alert>{error}</Alert> : null}
      {check === null && error === null ? <Spinner /> : null}
      {check !== null ? (
        <p>Database: <strong>{check.databaseName}</strong></p>
      ) : null}
      {blocker !== null ? <Alert>{blocker}</Alert> : null}
      {others && check !== null ? (
        <label className="check danger-ack">
          <input type="checkbox" checked={acknowledged} onChange={(e) => { setAcknowledged(e.target.checked) }} />
          <span>
            {describeActivity(check.otherSessions, check.otherUsers)} will be signed out, and their
            data deleted. I understand.
          </span>
        </label>
      ) : null}
      <ExportFirst>
        This downloads your own data only. Other people&rsquo;s data on this instance is not
        included; they would need to export their own first. There is no undo.
      </ExportFirst>
    </EraseDialog>
  )
}
