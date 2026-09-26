import type { StarterResult } from '../../categories/service/StarterResult.js'

/** Outcome of finishing setup. */
export interface OnboardingResult extends StarterResult {
  /** Always `true`: setup is recorded as finished. */
  readonly onboarded: true
}
