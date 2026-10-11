import { Button, Dialog } from '@wickermoney/ui-kit'
import type { Person } from '../../../models/index.js'

/** Props for {@link ConfirmDemotionDialog}. */
export interface ConfirmDemotionDialogProps {
  /** The owner who would become a member. */
  readonly person: Person
  /** True when `person` is the signed-in user, who would be removing their own access. */
  readonly isSelf: boolean
  /** True while the change is being saved; the buttons are locked until it settles. */
  readonly busy: boolean
  /** Called when the owner confirms. */
  readonly onConfirm: () => void
  /** Called when the owner backs out: Cancel, the close button, Escape or a click outside. */
  readonly onCancel: () => void
}

/**
 * Asks an owner to confirm making an owner a member.
 *
 * Demoting is the one direction that takes something away, so it is the only
 * one that asks. The text says what is lost and what is not (the account's
 * data and sign-in are untouched), and that an owner can undo it. When the
 * owner is demoting themselves it says that only another owner can undo it.
 * Focus starts on the close button, so pressing Enter right away cannot
 * confirm.
 */
export function ConfirmDemotionDialog({ person, isSelf, busy, onConfirm, onCancel }: ConfirmDemotionDialogProps) {
  return (
    <Dialog title={isSelf ? 'Remove your own owner access?' : `Make ${person.email} a member?`} onClose={() => { if (!busy) onCancel() }}>
      {isSelf ? (
        <p>
          You will stop being an owner right away. You will no longer be able to turn plugins on
          or off or change anyone&rsquo;s role, and only another owner can give that back to you.
          Your data and your sign-in are not affected.
        </p>
      ) : (
        <p>
          <strong>{person.email}</strong> will no longer be able to turn plugins on or off or change
          anyone&rsquo;s role. This applies on their next request, with no sign-out needed. Their data and
          sign-in are not affected, and you can make them an owner again at any time.
        </p>
      )}
      <div className="wm-dialog__actions">
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm} disabled={busy}>
          {busy ? 'Saving…' : isSelf ? 'Remove my owner access' : 'Make member'}
        </Button>
      </div>
    </Dialog>
  )
}
