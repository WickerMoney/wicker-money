import type { SituationGroup } from './SituationGroup.js'

/** Props for {@link WizardProgress}. */
export interface WizardProgressProps {
  /** Zero-based index of the current step. */
  readonly step: number
  /** All the wizard's steps, one tick each. */
  readonly groups: readonly SituationGroup[]
}

/** A row of ticks, filled up to and including the current step. Decorative. */
export function WizardProgress({ step, groups }: WizardProgressProps) {
  return (
    <div className="wiz__progress" aria-hidden="true">
      {groups.map((g, i) => (
        <span key={g.key} className={`wiz__tick${i <= step ? ' is-done' : ''}`} />
      ))}
    </div>
  )
}
