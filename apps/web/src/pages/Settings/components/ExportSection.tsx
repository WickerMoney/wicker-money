import { useState } from 'react'
import { Button, Surface } from '@wickermoney/ui-kit'
import { ExportPasswordDialog } from './ExportPasswordDialog.js'

/** A button that downloads everything the user owns as one JSON file, after asking for the password again. */
export function ExportSection() {
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState(false)

  return (
    <Surface title="Export all data">
      <p className="form-hint" style={{ margin: '0 0 10px' }}>
        Downloads a single JSON file with everything you own — accounts, transactions,
        splits, categories, rules, recurring items, and each installed plugin's own
        data (budgets, saved import mappings). Intended to be re-importable, not just
        readable. You will be asked for your password first.
      </p>
      <div className="export-actions">
        <Button variant="primary" aria-haspopup="dialog" onClick={() => { setDone(false); setOpen(true) }}>
          Download my data…
        </Button>
        <span className="wm-muted" role="status">{done ? 'Downloaded.' : ''}</span>
      </div>
      {open ? (
        <ExportPasswordDialog
          onClose={() => { setOpen(false) }}
          onExported={() => { setOpen(false); setDone(true) }}
        />
      ) : null}
    </Surface>
  )
}
