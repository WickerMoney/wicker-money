import { useEffect, useState } from 'react'
import { Alert, Spinner, Surface, Table } from '@wickermoney/ui-kit'
import { api } from '../../../api/client.js'
import { configRows } from '../helpers/configRows.js'
import type { ConfigInfo } from '../../../models/index.js'
import type { ConfigRow } from '../state/ConfigRow.js'

/** A read-only table of the server's non-secret runtime configuration. */
export function ConfigSection() {
  const [config, setConfig] = useState<ConfigInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api
      .get<ConfigInfo>('/settings/config')
      .then((c) => { if (live) setConfig(c) })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : 'Could not load configuration.') })
    return () => { live = false }
  }, [])

  return (
    <Surface title="Config">
      {error !== null ? <Alert>{error}</Alert> : null}
      {config === null && error === null ? <Spinner label="Loading configuration" /> : null}
      {config !== null ? (
        <Table<ConfigRow>
          columns={[
            { key: 'label', header: 'Setting', render: (r) => r.label },
            { key: 'value', header: 'Value', render: (r) => <code>{r.value}</code> },
          ]}
          rows={configRows(config)}
          rowKey={(r) => r.label}
        />
      ) : null}
    </Surface>
  )
}
