import type { SituationGroup } from './SituationGroup.js'
import { WizardIntro } from './WizardIntro.js'
import { WizardQuestion } from './WizardQuestion.js'

/** Props for {@link WizardStep}. */
export interface WizardStepProps {
  /** The group of questions this step shows. */
  readonly group: SituationGroup | undefined
  /** `true` for the first step, which also shows the introduction. */
  readonly first: boolean
  /** The situation slugs currently ticked. */
  readonly chosen: ReadonlySet<string>
  /** Called when a question is toggled. */
  readonly onToggle: (situation: string) => void
}

/** One step of the wizard: the introduction (first step only), the group's hint and its questions. */
export function WizardStep({ group, first, chosen, onToggle }: WizardStepProps) {
  return (
    <>
      {first ? <WizardIntro /> : null}

      {group?.hint !== null && group?.hint !== undefined ? (
        <p className="wiz__hint">{group.hint}</p>
      ) : null}

      <div className="wiz__questions">
        {group?.questions.map((q) => (
          <WizardQuestion
            key={q.situation} question={q}
            checked={chosen.has(q.situation)} onToggle={onToggle}
          />
        ))}
      </div>
    </>
  )
}
