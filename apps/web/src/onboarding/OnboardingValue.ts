import type { OnboardingStatus } from './OnboardingStatus.js'

/** What {@link useOnboarding} exposes to components. */
export interface OnboardingValue {
  /** `null` until the first load completes. */
  readonly status: OnboardingStatus | null
  /** `true` while the wizard should be on screen. */
  readonly open: boolean
  /** Opens the wizard by hand, for the "run setup again" path. */
  readonly start: () => void
  /** Closes the wizard without finishing. `onboardedAt` stays `null`, so it returns next time. */
  readonly dismiss: () => void
  /** Re-reads the status after the wizard writes. */
  readonly refresh: () => Promise<void>
}
