import { api } from '../../../api/client.js'
import { useAuth } from '../../../auth/index.js'
import { ERASE_PHRASES } from '../helpers/ERASE_PHRASES.js'
import { EraseDialog } from './EraseDialog.js'
import { ExportFirst } from './ExportFirst.js'

/** Props for {@link EraseMyDataDialog}. */
export interface EraseMyDataDialogProps {
  /** Closes the dialog without erasing. */
  readonly onClose: () => void
}

/**
 * Confirmation for "Erase my data": deletes everything the signed-in person
 * owns (accounts, transactions, categories, rules, recurring items and every
 * plugin's data) and signs them out. Their login survives, so they can sign in
 * and start again.
 */
export function EraseMyDataDialog({ onClose }: EraseMyDataDialogProps) {
  const { user, signOut } = useAuth()
  return (
    <EraseDialog
      title="Erase my data"
      phrase={ERASE_PHRASES.myData}
      confirmLabel="Erase my data"
      onClose={onClose}
      submit={(input) => api.post('/settings/erase-my-data', input)}
      onErased={signOut}
    >
      <p>
        This permanently deletes everything in <strong>{user?.email ?? 'your account'}</strong>:
        accounts, transactions, categories, rules, recurring items, and every plugin&rsquo;s data.
        You will be signed out on every device. Your login stays, so you can sign in and start again.
        Other people on this instance are not affected.
      </p>
      <ExportFirst>
        There is no undo. Download a copy of your data first if you might want it back.
      </ExportFirst>
    </EraseDialog>
  )
}
