import { useEffect, useState } from 'react'
import { fetchPeople } from './peopleApi.js'
import type { PeopleState } from './PeopleState.js'

/**
 * Loads every account on the instance, for an owner.
 *
 * Only requested when `enabled`, which callers set from the signed-in user's
 * role, so a member's app never asks an endpoint it would be refused. The
 * server still refuses a member on its own; if the role the app holds is out
 * of date (an owner demoted mid-session), that refusal arrives as an error.
 *
 * @param enabled - Whether to request the listing at all.
 * @returns The listing state; `skipped` when not enabled.
 */
export function usePeople(enabled: boolean): PeopleState {
  const [state, setState] = useState<PeopleState>({ kind: 'loading' })

  useEffect(() => {
    if (!enabled) return
    let live = true
    fetchPeople()
      .then((people) => { if (live) setState({ kind: 'loaded', people }) })
      .catch((e: unknown) => {
        if (live) setState({ kind: 'error', message: e instanceof Error ? e.message : 'Could not load people.' })
      })
    return () => { live = false }
  }, [enabled])

  return enabled ? state : { kind: 'skipped' }
}
