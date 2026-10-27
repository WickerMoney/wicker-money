import { useState } from 'react'
import { Button, Surface, useToast } from '@wickermoney/ui-kit'
import { ExportPasswordDialog } from './ExportPasswordDialog.js'

/**
 * A button that downloads everything the user owns as one JSON file, after
 * asking for the password again. The result is a toast, raised once the
 * password dialog has closed (ADR 0009); a refusal stays in the dialog.
 */
export function ExportSection() {
  const [open, setOpen] = useState(false)
  const toast = useToast()

  return (
    <Surface title="Export all data">
      <p className="form-hint" style={{ margin: '0 0 10px' }}>
        Downloads a single JSON file with everything you own — accounts, transactions,
        splits, categories, rules, recurring items, and each installed plugin's own
        data (budgets, saved import mappings). Intended to be re-importable, not just
        readable. You will be asked for your password first.
      </p>
      <div className="export-actions">
        <Button variant="primary" aria-haspopup="dialog" onClick={() => { setOpen(true) }}>
          Download my data…
        </Button>
      </div>
      {open ? (
        <ExportPasswordDialog
          onClose={() => { setOpen(false) }}
          onExported={() => {
            setOpen(false)
            toast.show('Downloaded your data as a JSON file.', { kind: 'success', key: 'settings:export' })
          }}
        />
      ) : null}
    </Surface>
  )
}
