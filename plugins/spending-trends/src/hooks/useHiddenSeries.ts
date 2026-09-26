import { useCallback, useState } from 'react'

/** What {@link useHiddenSeries} returns. */
export interface HiddenSeries {
  /** The ids of the series the reader has turned off. */
  readonly hidden: ReadonlySet<string>
  /** Turns a series off, or back on. */
  readonly toggle: (id: string) => void
}

/**
 * Tracks which categories the reader has filtered out of the chart.
 *
 * Kept by id, so a hidden category stays hidden when the range changes and it
 * reappears in the data, and an id that is no longer present is simply ignored.
 *
 * @returns The hidden ids and a toggle.
 */
export function useHiddenSeries(): HiddenSeries {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const toggle = useCallback((id: string) => {
    setHidden((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  return { hidden, toggle }
}
