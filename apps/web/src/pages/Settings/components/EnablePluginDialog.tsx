import { useId } from 'react'
import { Button, Dialog } from '@wickermoney/ui-kit'
import type { RegisteredPlugin } from '../../../models/index.js'

/** The documentation section that explains how far a plugin is trusted. */
export const TRUST_DOC_URL = 'https://wickermoney.dev/docs/features/plugins#how-much-a-plugin-is-trusted'

/** Props for {@link EnablePluginDialog}. */
export interface EnablePluginDialogProps {
  /** The plugin the owner is about to switch on. Not a bundled one. */
  readonly plugin: RegisteredPlugin
  /** Called when the owner confirms. */
  readonly onConfirm: () => void
  /** Called when the owner backs out: Cancel, the close button, Escape or a click outside. */
  readonly onCancel: () => void
}

/**
 * Asks an owner to confirm switching on a plugin that Wicker Money did not ship.
 *
 * The wording follows `SECURITY.md` ("Third-party plugins" and "Known gaps")
 * and claims no more and no less than it does: the plugin's UI runs in a
 * sandboxed frame, has no server-side code, reaches only read-only routes for
 * the tables its manifest lists, and can still send what it holds to another
 * server through the gaps the frame's policy does not cover. If that
 * document changes, change this text with it.
 *
 * Focus starts on the close button, which cancels, so pressing Enter right
 * away cannot confirm. The summary paragraph is the dialog's accessible
 * description.
 */
export function EnablePluginDialog({ plugin, onConfirm, onCancel }: EnablePluginDialogProps) {
  const summaryId = useId()
  const refused = plugin.failure !== null
  const origin = plugin.origin ?? (refused ? 'unknown, because its manifest is refused' : 'this instance itself')
  return (
    <Dialog title={`Turn on ${plugin.name}?`} describedBy={summaryId} onClose={onCancel}>
      <p id={summaryId} className="consent-warning">
        {plugin.name} was not shipped with Wicker Money. Third-party plugins are experimental, and the
        sandbox they run in has not been independently reviewed. Read this before you turn it on for
        everyone on this instance.
      </p>
      <ul className="consent-facts">
        <li>
          It loads its code from <code>{origin}</code>.
        </li>
        <li>
          {plugin.tables.length > 0
            ? <>It is granted read access to these tables: <strong>{plugin.tables.join(', ')}</strong>. It can only read them.</>
            : <>{refused ? 'Which tables it is granted is unknown, because its manifest is refused.' : 'Its manifest lists no tables, so it is granted read access to none.'}</>}
          {' '}It also sees your email address and user ID.
        </li>
        <li>It runs in a sandboxed frame, with no access to the app&rsquo;s cookies, storage or page.</li>
        <li>It has no server-side code, no storage and no scheduled work on this server.</li>
        <li>
          The sandbox has known gaps. A plugin that is granted your transactions can send them to
          another server through those gaps, and anything else it reads can leave the same way. They
          were observed in Chromium 141; Firefox and Safari have not been tested.
        </li>
      </ul>
      {refused ? <p className="plugin-card__failure">Would not load now: {plugin.failure}</p> : null}
      <p>
        This is code you are choosing to run inside a cage that has known gaps, not code that is safe
        to run. If you would not give it these tables, do not turn it on.
      </p>
      <p>
        <a className="consent-link" href={TRUST_DOC_URL} target="_blank" rel="noopener noreferrer">
          How far a plugin is trusted (opens in a new tab)
        </a>
      </p>
      <div className="wm-dialog__actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={onConfirm}>Enable plugin</Button>
      </div>
    </Dialog>
  )
}
