import { useState } from 'react'
import { Button } from '@wickermoney/ui-kit'
import { ExportPasswordDialog } from './ExportPasswordDialog.js'

/** Props for {@link ExportFirst}. */
export interface ExportFirstProps {
  /** What the download does and does not contain, shown above the button. */
  readonly children: string
}

/**
 * "Download my data first": the export, offered inside an erase dialog before
 * anything is deleted. It asks for the password in its own dialog, on top of
 * the erase dialog, and never touches the erase form's fields or buttons.
 */
export function ExportFirst({ children }: ExportFirstProps) {
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState(false)

  return (
    <div className="danger-export">
      <p className="form-hint">{children}</p>
      <Button aria-haspopup="dialog" onClick={() => { setDone(false); setOpen(true) }}>
        Download my data first…
      </Button>
      <span className="wm-muted" role="status">{done ? 'Downloaded.' : ''}</span>
      {open ? (
        <ExportPasswordDialog
          onClose={() => { setOpen(false) }}
          onExported={() => { setOpen(false); setDone(true) }}
        />
      ) : null}
    </div>
  )
}
