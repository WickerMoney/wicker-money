import type { SituationQuestion } from './SituationQuestion.js'

/** Props for {@link WizardQuestion}. */
export interface WizardQuestionProps {
  /** The question to render. */
  readonly question: SituationQuestion
  /** Whether it is currently ticked. */
  readonly checked: boolean
  /** Called when the checkbox is toggled. */
  readonly onToggle: (situation: string) => void
}

/** One tickable question with its optional clarification. */
export function WizardQuestion({ question: q, checked, onToggle }: WizardQuestionProps) {
  return (
    <label className={`wiz__q${checked ? ' is-on' : ''}`}>
      <input type="checkbox" checked={checked} onChange={() => onToggle(q.situation)} />
      <span className="wiz__q-text">
        <span className="wiz__q-label">{q.label}</span>
        {q.hint !== null ? <span className="wiz__q-hint">{q.hint}</span> : null}
      </span>
    </label>
  )
}
