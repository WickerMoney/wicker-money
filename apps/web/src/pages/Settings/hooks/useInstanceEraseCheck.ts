import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../api/client.js'
import type { InstanceEraseCheck } from '../state/InstanceEraseCheck.js'

/** What {@link useInstanceEraseCheck} returns. */
export interface InstanceEraseCheckState {
  /** The answer, or `null` while loading or after a failure. */
  readonly check: InstanceEraseCheck | null
  /** Why loading failed, or `null`. */
  readonly error: string | null
  /** Asks again, for example after the server says the answer has changed. */
  readonly reload: () => void
}

/** Loads the owner's preflight for "erase this instance" when it mounts. */
export function useInstanceEraseCheck(): InstanceEraseCheckState {
  const [check, setCheck] = useState<InstanceEraseCheck | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    api.get<InstanceEraseCheck>('/settings/erase-instance')
      .then((value) => { if (current) { setCheck(value); setError(null) } })
      .catch((e: unknown) => {
        if (current) setError(e instanceof Error ? e.message : 'Could not check the instance.')
      })
    return () => { current = false }
  }, [attempt])

  const reload = useCallback(() => { setAttempt((n) => n + 1) }, [])
  return { check, error, reload }
}
