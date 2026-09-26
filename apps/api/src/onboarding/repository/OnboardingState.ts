/** The setup-wizard columns of a user row. */
export interface OnboardingState {
  /** When setup was finished, or `null` if it has not been. */
  readonly onboarded_at: Date | null
  /** The situation slugs the user answered with. */
  readonly onboarding_situations: readonly string[]
}
