import type { Situation, SituationGroup } from '../../categories/catalog.js'

/** Whether setup is needed, the answers so far, and the questions to ask. */
export interface OnboardingStatus {
  /** When setup was finished as an ISO-8601 string, or `null` if it has not been. */
  readonly onboardedAt: string | null
  /** The situations the user answered with. */
  readonly situations: readonly Situation[]
  /** How many categories the user has. */
  readonly categoryCount: number
  /** The wizard's questions, from the catalog. */
  readonly groups: readonly SituationGroup[]
}
