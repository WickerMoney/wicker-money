import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../api/client.js'
import { OnboardingCtx } from './onboardingContext.js'
import type { OnboardingStatus } from './OnboardingStatus.js'
import type { OnboardingValue } from './OnboardingValue.js'

/** Props for {@link OnboardingProvider}. */
export interface OnboardingProviderProps {
  /** The subtree that can call `useOnboarding`. */
  readonly children: ReactNode
}

/**
 * Tracks whether first-run setup is needed, and lets any page ask for it.
 *
 * The status lives here rather than in a single page because the wizard is not
 * a categories feature: someone whose first click is Transactions should meet it
 * too, and every page needs the same answer to "has this account been set up".
 *
 * Only the `onboardedAt` flag opens the wizard. A user with no categories who
 * has finished setup (deleted them all, say) is not shown it again; a user with
 * categories who has not finished it is. The flag records intent and the
 * category count is a consequence, and treating the consequence as the trigger
 * is how a wizard ends up reappearing every time someone tidies up.
 */
export function OnboardingProvider({ children }: OnboardingProviderProps) {
  const [status, setStatus] = useState<OnboardingStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [requested, setRequested] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.get<OnboardingStatus>('/onboarding'))
    } catch {
      // A failure here must not block the app. Worst case the wizard does not
      // appear, and the Categories page still offers it by hand.
      setStatus({ onboardedAt: new Date().toISOString(), situations: [], categoryCount: 0, groups: [] })
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const value = useMemo<OnboardingValue>(() => ({
    status,
    open: requested || (status !== null && status.onboardedAt === null && !dismissed),
    start: () => { setDismissed(false); setRequested(true) },
    dismiss: () => { setRequested(false); setDismissed(true) },
    refresh: async () => { setRequested(false); setDismissed(false); await refresh() },
  }), [status, dismissed, requested, refresh])

  return <OnboardingCtx.Provider value={value}>{children}</OnboardingCtx.Provider>
}
