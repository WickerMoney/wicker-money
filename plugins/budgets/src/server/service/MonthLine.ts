import type { LineStatus } from '../../shared/index.js'

/** One budget line as the month endpoint reports it: computed status plus what is stored. */
export interface MonthLine extends LineStatus {
  /** Null while this line is only a draft; nothing is written until it is edited. */
  readonly id: string | null
  /** The balance brought in from earlier months, as a decimal string. */
  readonly carriedIn: string
  readonly note: string | null
  /** True when the line was copied from the previous month and has no row yet. */
  readonly draft: boolean
}
