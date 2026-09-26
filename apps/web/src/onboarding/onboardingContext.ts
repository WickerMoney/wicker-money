import { createContext } from 'react'
import type { OnboardingValue } from './OnboardingValue.js'

/** The React context that carries {@link OnboardingValue}. Read it through `useOnboarding`, not directly. */
export const OnboardingCtx = createContext<OnboardingValue | null>(null)
