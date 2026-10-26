import { useCallback, useMemo, useState } from 'react'

/**
 * Shared "something is in flight / the page could not load" state for a page.
 *
 * Since ADR 0009 the outcome of an action is a toast (`useToast`), not a
 * message here: this carries the busy flag, and the one alert a page shows when
 * its data failed to load.
 */
export interface ActionStatus {
  /** The load failure currently shown in the page's alert, or `null` when there is none. */
  readonly message: string | null
  /** `true` while an action is running; controls are disabled while it is. */
  readonly busy: boolean
  /** Marks an action as started: disables controls and clears a shown load failure. */
  begin(): void
  /** Marks the running action as finished. Call from a `finally` block. */
  end(): void
  /** Shows a load failure in the page's alert, replacing any earlier one. Not for the result of an action: raise a toast. */
  show(message: string): void
}

/**
 * Tracks the busy flag that every page action shares, and the alert message
 * for a failed load.
 *
 * A new message replaces the previous one instead of stacking. Successes and
 * failures of actions are not shown here (ADR 0009, section 3).
 *
 * @returns A stable-identity {@link ActionStatus} whose methods never change.
 */
export function useActionStatus(): ActionStatus {
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const begin = useCallback(() => { setBusy(true); setMessage(null) }, [])
  const end = useCallback(() => setBusy(false), [])
  const show = useCallback((next: string) => setMessage(next), [])

  return useMemo(() => ({ message, busy, begin, end, show }), [message, busy, begin, end, show])
}
