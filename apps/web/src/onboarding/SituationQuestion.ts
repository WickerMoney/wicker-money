/** One yes/no question in the setup wizard. */
export interface SituationQuestion {
  /** The situation slug stored when the user ticks this question. */
  readonly situation: string
  /** The question text. */
  readonly label: string
  /** Optional clarification shown under the label, or `null`. */
  readonly hint: string | null
}
