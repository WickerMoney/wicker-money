/** The wizard's current selection and the way to change it. */
export interface WizardAnswers {
  /** The situation slugs currently ticked. */
  readonly chosen: ReadonlySet<string>
  /** Ticks a situation, or unticks it if it is ticked. */
  readonly toggle: (situation: string) => void
}
