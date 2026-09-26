import { Button, SelectField, Surface } from '@wickermoney/ui-kit'
import type { AccountDeletion } from '../hooks/useAccountDeletion.js'
import { describeUsage } from '../helpers/describeUsage.js'
import { MigrationPreviewNote } from './MigrationPreviewNote.js'

/** Props for {@link DeleteAccountPanel}. */
export interface DeleteAccountPanelProps {
  /** The delete-resolution state and actions. */
  readonly deletion: AccountDeletion
  /** `true` while a request is in flight; disables the controls. */
  readonly busy: boolean
}

/**
 * The choices offered when a delete finds that the account still has history:
 * archive it, delete it together with its history, or move the history into
 * another account first.
 *
 * Renders nothing unless a delete is being resolved.
 */
export function DeleteAccountPanel({ deletion, busy }: DeleteAccountPanelProps) {
  const { resolving, migrateTargets, migrateTargetId, migratePlan } = deletion
  if (resolving === null) return null

  return (
    <Surface title={`Delete '${resolving.account.name}'`}>
      <p className="form-hint">
        '{resolving.account.name}' still has {describeUsage(resolving.usage)}. Pick one:
      </p>

      <div className="page__row">
        <div>
          <p className="form-hint"><strong>Archive</strong> -- hide it, keep everything exactly as it is.</p>
          <Button disabled={busy} onClick={() => void deletion.archive(resolving.account)}>Archive instead</Button>
        </div>

        <div>
          <p className="form-hint">
            <strong>Delete the history too</strong> -- removes {describeUsage(resolving.usage)} along with the
            account. If any of that history is a transfer, the other leg (even on a different account)
            is removed with it. This cannot be undone.
          </p>
          <Button variant="danger" disabled={busy} onClick={() => void deletion.deleteWithHistory()}>
            Delete account and history
          </Button>
        </div>

        <div>
          <p className="form-hint">
            <strong>Move it to another account</strong> -- keeps the history by relocating it first, then
            deletes '{resolving.account.name}'. Only accounts in the same currency are offered.
          </p>
          {migrateTargets.length === 0 ? (
            <p className="form-hint">No other active account to move it to.</p>
          ) : (
            <>
              <SelectField
                label="Move history to"
                value={migrateTargetId}
                onChange={(e) => deletion.chooseTarget(e.target.value)}
              >
                <option value="">Choose an account</option>
                {migrateTargets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </SelectField>
              <div className="page__actions page__actions--tight">
                <Button disabled={busy || migrateTargetId === ''} onClick={() => void deletion.previewMigrate()}>
                  Preview move
                </Button>
                <Button
                  variant="primary" disabled={busy || migratePlan === null}
                  onClick={() => void deletion.commitMigrate()}
                >
                  Confirm move
                </Button>
              </div>
              {migratePlan !== null ? <MigrationPreviewNote plan={migratePlan} /> : null}
            </>
          )}
        </div>
      </div>

      <div className="page__actions">
        <Button disabled={busy} onClick={deletion.dismiss}>Cancel</Button>
      </div>
    </Surface>
  )
}
