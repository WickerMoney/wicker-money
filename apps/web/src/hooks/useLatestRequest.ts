import { useEffect, useMemo } from 'react'
import { isAbortError } from '../api/isAbortError.js'
import type { LatestRequest } from './LatestRequest.js'

/**
 * Guards against stale responses: of several overlapping requests, only the
 * last one started may apply its result.
 *
 * Without it, two requests that resolve out of order leave the screen showing
 * the answer to the older question. Unmounting cancels whatever is in flight,
 * so a response cannot land on a component that is gone.
 *
 * @returns A stable {@link LatestRequest}.
 */
export function useLatestRequest(): LatestRequest {
  const guard = useMemo(() => {
    let current: AbortController | null = null

    const cancel = () => {
      current?.abort()
      current = null
    }

    const run = async <T,>(
      load: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void,
    ): Promise<void> => {
      current?.abort()
      const controller = new AbortController()
      current = controller
      try {
        const value = await load(controller.signal)
        if (!controller.signal.aborted) apply(value)
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) return
        throw error
      } finally {
        if (current === controller) current = null
      }
    }

    return { run, cancel }
  }, [])

  useEffect(() => guard.cancel, [guard])

  return guard
}
