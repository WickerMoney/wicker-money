import { useCallback, useEffect, useState } from 'react'
import type { OnboardingStatus } from './OnboardingStatus.js'
import type { WizardAnswers } from './WizardAnswers.js'

/**
 * The situations the user has ticked in the wizard.
 *
 * Re-answering starts from last time's answers rather than from nothing:
 * someone re-running setup because they got a dog should tick one box, not
 * thirty.
 *
 * @param open - Whether the wizard is on screen; the answers reset each time it opens.
 * @param status - The stored onboarding status holding the previous answers.
 * @returns The ticked situations and a function that ticks or unticks one.
 */
export function useWizardAnswers(open: boolean, status: OnboardingStatus | null): WizardAnswers {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    if (open) setChosen(new Set((status?.situations ?? []).filter((s) => s !== 'always')))
  }, [open, status])

  const toggle = useCallback((situation: string) => {
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(situation)) next.delete(situation)
      else next.add(situation)
      return next
    })
  }, [])

  return { chosen, toggle }
}
