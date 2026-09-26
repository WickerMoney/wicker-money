import type { Health } from '../../shared/index.js'
import { HEALTH_CLASS } from '../helpers/healthClass.js'

const TEXT: Record<Health, string> = {
  over: 'Over',
  'at-risk': 'Ahead of pace',
  ahead: 'Under pace',
  'on-track': 'On track',
  unused: 'Nothing spent',
}

/** Props for {@link HealthDot}. */
export interface HealthDotProps {
  readonly health: Health
}

/** A coloured dot followed by a plain-words description of a line's health. */
export function HealthDot({ health }: HealthDotProps) {
  return (
    <span className="bud__health">
      <span className={`bud__dot ${HEALTH_CLASS[health]}`} aria-hidden="true" />
      {TEXT[health]}
    </span>
  )
}
