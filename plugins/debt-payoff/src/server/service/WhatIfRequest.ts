import type { Strategy } from '../../shared/index.js'
import type { LumpSumFields } from './LumpSumFields.js'

/** What a what-if is asked for; the plan settings left out come from the person's saved ones. */
export interface WhatIfRequest {
  /** The lump sum to try. Its note is not used. */
  readonly candidate: LumpSumFields
  readonly strategy?: Strategy
  readonly extraPayment?: string
  /** The IANA time zone that decides what today is. */
  readonly timezone: string
}
