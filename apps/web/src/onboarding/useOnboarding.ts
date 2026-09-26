import { useContext } from 'react'
import { OnboardingCtx } from './onboardingContext.js'
import type { OnboardingValue } from './OnboardingValue.js'

/**
 * Reads the setup state and wizard controls.
 *
 * @returns The setup status, whether the wizard is open, and the actions that open, dismiss and refresh it.
 * @throws {Error} If called outside an `OnboardingProvider`.
 */
export function useOnboarding(): OnboardingValue {
  const value = useContext(OnboardingCtx)
  if (value === null) throw new Error('useOnboarding must be used inside an OnboardingProvider.')
  return value
}
