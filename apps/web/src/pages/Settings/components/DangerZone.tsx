import { useState } from 'react'
import { Button, Surface } from '@wickermoney/ui-kit'
import { useAuth } from '../../../auth/index.js'
import { EraseInstanceDialog } from './EraseInstanceDialog.js'
import { EraseMyDataDialog } from './EraseMyDataDialog.js'

/** Which confirmation is open. */
type Open = 'my-data' | 'instance' | null

/**
 * The bottom of Settings: "Erase my data" for everyone and, for an owner, a
 * separate "Erase this entire instance". Each is its own section with its own
 * button and its own confirmation; neither can be done from the other.
 */
export function DangerZone() {
  const { user } = useAuth()
  const [open, setOpen] = useState<Open>(null)
  const close = () => { setOpen(null) }

  return (
    <>
      <div className="danger-zone">
        <Surface title="Erase my data">
          <p className="form-hint">
            Deletes everything you own on this instance and signs you out. Your login stays. Other
            people&rsquo;s data is untouched.
          </p>
          <Button variant="danger" onClick={() => { setOpen('my-data') }}>Erase my data…</Button>
        </Surface>
        {user?.role === 'owner' ? (
          <Surface title="Erase this entire instance">
            <p className="form-hint">
              Owner only. Deletes every account and all of their data, then leaves the instance empty so
              the next person to register becomes its owner.
            </p>
            <Button variant="danger" onClick={() => { setOpen('instance') }}>Erase this instance…</Button>
          </Surface>
        ) : null}
      </div>
      {open === 'my-data' ? <EraseMyDataDialog onClose={close} /> : null}
      {open === 'instance' ? <EraseInstanceDialog onClose={close} /> : null}
    </>
  )
}
