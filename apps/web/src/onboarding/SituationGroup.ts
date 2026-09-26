import type { SituationQuestion } from './SituationQuestion.js'

/** A titled set of related questions, shown as one step of the wizard. */
export interface SituationGroup {
  /** Stable identifier for the group. */
  readonly key: string
  /** Heading of the wizard step. */
  readonly title: string
  /** Optional introduction shown under the title, or `null`. */
  readonly hint: string | null
  /** The questions in this step, in display order. */
  readonly questions: readonly SituationQuestion[]
}
