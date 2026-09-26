import { useCallback, useMemo, useState } from 'react'

/** Shared "something is in flight / something went wrong" state for a page. */
export interface ActionStatus {
  /** The message currently shown in the page's alert, or `null` when there is none. */
  readonly message: string | null
  /** `true` while an action is running; controls are disabled while it is. */
  readonly busy: boolean
  /** Marks an action as started: disables controls and clears the previous message. */
  begin(): void
  /** Marks the running action as finished. Call from a `finally` block. */
  end(): void
  /** Replaces the page's alert text. Pass `null` to clear it. */
  show(message: string | null): void
}

/**
 * Tracks the busy flag and alert message that every page action shares.
 *
 * The alert carries both failures and success notices, so a new message always
 * replaces the previous one instead of stacking.
 *
 * @returns A stable-identity {@link ActionStatus} whose methods never change.
 */
export function useActionStatus(): ActionStatus {
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const begin = useCallback(() => { setBusy(true); setMessage(null) }, [])
  const end = useCallback(() => setBusy(false), [])
  const show = useCallback((next: string | null) => setMessage(next), [])

  return useMemo(() => ({ message, busy, begin, end, show }), [message, busy, begin, end, show])
}
