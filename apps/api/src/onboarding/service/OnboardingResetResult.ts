import type { RemovalResult } from '../../categories/service/RemovalResult.js'

/** Outcome of resetting setup. */
export interface OnboardingResetResult extends RemovalResult {
  /** Always `false`: setup is no longer recorded as finished. */
  readonly onboarded: false
}
