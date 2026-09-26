import type { SituationGroup } from './SituationGroup.js'

/** The account's setup state, as returned by `GET /onboarding`. */
export interface OnboardingStatus {
  /** ISO timestamp of when setup was finished, or `null` if it never has been. */
  readonly onboardedAt: string | null
  /** The situation slugs the user last answered "yes" to. */
  readonly situations: readonly string[]
  /** How many categories the user currently has. */
  readonly categoryCount: number
  /** The questions to ask. Supplied by the server so the wizard cannot offer an option that creates nothing. */
  readonly groups: readonly SituationGroup[]
}
