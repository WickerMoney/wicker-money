import { Alert, Button, Surface } from '@wickermoney/ui-kit'
import { useDataExport } from '../hooks/useDataExport.js'

/** A button that downloads everything the user owns as one JSON file. */
export function ExportSection() {
  const { busy, error, run } = useDataExport()

  return (
    <Surface title="Export all data">
      <p className="form-hint" style={{ margin: '0 0 10px' }}>
        Downloads a single JSON file with everything you own — accounts, transactions,
        splits, categories, rules, recurring items, and each installed plugin's own
        data (budgets, saved import mappings). Intended to be re-importable, not just
        readable.
      </p>
      {error !== null ? <Alert>{error}</Alert> : null}
      <Button variant="primary" onClick={() => { void run() }} disabled={busy}>
        {busy ? 'Preparing export…' : 'Download my data'}
      </Button>
    </Surface>
  )
}
