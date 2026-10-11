import type { Strategy } from '../../shared/index.js'

/** What a plan request asks for; anything left out comes from the person's saved settings. */
export interface PlanRequest {
  readonly strategy?: Strategy
  readonly extraPayment?: string
  /** The IANA time zone that decides what today is. */
  readonly timezone: string
}
