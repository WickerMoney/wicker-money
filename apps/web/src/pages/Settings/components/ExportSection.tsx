import { useState } from 'react'
import { Alert, Button, Surface } from '@wickermoney/ui-kit'
import { api } from '../../../api/client.js'
import { localIsoDate } from '../../../lib/localIsoDate.js'
import { downloadJson } from '../helpers/downloadJson.js'

/** A button that downloads everything the user owns as one JSON file. */
export function ExportSection() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runExport = async () => {
    setBusy(true); setError(null)
    try {
      const data = await api.get<unknown>('/settings/export')
      const today = localIsoDate()
      downloadJson(data, `wickermoney-export-${today}.json`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not export your data.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Surface title="Export all data">
      <p className="form-hint" style={{ margin: '0 0 10px' }}>
        Downloads a single JSON file with everything you own — accounts, transactions,
        splits, categories, rules, recurring items, and each installed plugin's own
        data (budgets, saved import mappings). Intended to be re-importable, not just
        readable.
      </p>
      {error !== null ? <Alert>{error}</Alert> : null}
      <Button variant="primary" onClick={() => { void runExport() }} disabled={busy}>
        {busy ? 'Preparing export…' : 'Download my data'}
      </Button>
    </Surface>
  )
}
