import { useEffect, useState } from 'react'
import { api } from '../api/client.js'
import type { PreviewResult } from './PreviewResult.js'

/**
 * The running total for the wizard, computed by the server from the same
 * selection the write uses.
 *
 * Debounced, because ticking three boxes in a row should not queue three
 * requests whose answers arrive out of order — the last one to return would
 * win regardless of which was last asked.
 *
 * @param open - Whether the wizard is on screen; nothing is requested while it is not.
 * @param chosen - The situations currently ticked.
 * @returns The preview for the current selection, or `null` until one arrives or when it failed.
 */
export function useSetupPreview(open: boolean, chosen: ReadonlySet<string>): PreviewResult | null {
  const [preview, setPreview] = useState<PreviewResult | null>(null)

  useEffect(() => {
    if (!open) return
    let live = true
    const timer = setTimeout(() => {
      api.post<PreviewResult>('/onboarding/preview', { situations: [...chosen] })
        .then((r) => { if (live) setPreview(r) })
        .catch(() => { if (live) setPreview(null) })
    }, 150)
    return () => { live = false; clearTimeout(timer) }
  }, [open, chosen])

  return preview
}
