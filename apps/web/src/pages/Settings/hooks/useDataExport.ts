import { useState } from 'react'
import { api } from '../../../api/client.js'
import { localIsoDate } from '../../../lib/localIsoDate.js'
import { downloadJson } from '../helpers/downloadJson.js'

/** What {@link useDataExport} returns. */
export interface DataExport {
  /** `true` while the export is being fetched. */
  readonly busy: boolean
  /** Why the last attempt failed, or `null`. */
  readonly error: string | null
  /** `true` once a file has been handed to the browser since the hook mounted. */
  readonly done: boolean
  /** Fetches the export and starts the download. Never rejects; failures land in `error`. */
  readonly run: () => Promise<void>
}

/**
 * Downloads everything the signed-in user owns as one JSON file.
 *
 * Shared by the Export section and by the erase dialogs, which offer the same
 * download before anything is deleted.
 */
export function useDataExport(): DataExport {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const run = async () => {
    setBusy(true); setError(null)
    try {
      const data = await api.get<unknown>('/settings/export')
      downloadJson(data, `wickermoney-export-${localIsoDate()}.json`)
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not export your data.')
    } finally {
      setBusy(false)
    }
  }

  return { busy, error, done, run }
}
