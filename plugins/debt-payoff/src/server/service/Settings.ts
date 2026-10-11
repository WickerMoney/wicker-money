import type { Strategy } from '../../shared/index.js'

/** The person's saved plan choices. */
export interface Settings {
  /** Paid every month on top of the minimums. */
  readonly extraPayment: string
  /** Where the money above the minimums goes first. */
  readonly strategy: Strategy
  /** Whether the person has saved a choice; `false` means these are the defaults. */
  readonly saved: boolean
}

/** The settings changes a request can make; any not sent keep their value. */
export interface SettingsChanges {
  readonly extraPayment?: string
  readonly strategy?: Strategy
}
