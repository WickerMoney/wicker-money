import type { Ref } from 'react'
import { Button } from '@wickermoney/ui-kit'
import type { SituationGroup } from './SituationGroup.js'

/** Props for {@link WizardHeader}. */
export interface WizardHeaderProps {
  /** Zero-based index of the current step. */
  readonly step: number
  /** All the wizard's steps, in order. */
  readonly groups: readonly SituationGroup[]
  /** Called to close the wizard without finishing. */
  readonly onDismiss: () => void
  /** Ref to the title, which the wizard focuses when the step changes. */
  readonly headingRef?: Ref<HTMLHeadingElement>
}

/**
 * The wizard's title, step counter and dismiss button.
 *
 * The button says "Not now", not "Skip": nothing is recorded, so the wizard
 * opens again next time. Saying so is better than a dismissal that quietly
 * turns out to be temporary.
 */
export function WizardHeader({ step, groups, onDismiss, headingRef }: WizardHeaderProps) {
  return (
    <header className="wiz__head">
      <div>
        <h2 className="wiz__title" id="wiz-title" tabIndex={-1} ref={headingRef}>Set up your categories</h2>
        <p className="wiz__sub">
          Step {step + 1} of {groups.length} · {groups[step]?.title}
        </p>
      </div>
      <Button onClick={onDismiss}>Not now</Button>
    </header>
  )
}
