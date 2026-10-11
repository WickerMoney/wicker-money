import type { Strategy } from '../../shared/index.js'

/** `GET /settings`: what the person last chose, or the defaults before they chose. */
export interface PlanSettings {
  readonly strategy: Strategy
  /** The monthly extra, as a decimal string. */
  readonly extraPayment: string
  /** Whether the person has saved a choice yet. */
  readonly saved: boolean
}
