import type { LineStatus } from '../../shared/index.js'
import type { LineWindow } from './LineWindow.js'

/** One budget line as the month endpoint reports it: computed status plus what is stored. */
export interface MonthLine extends LineStatus {
  /** Null while this line is only a draft; nothing is written until it is edited. */
  readonly id: string | null
  /** The balance brought in from earlier months, as a decimal string. */
  readonly carriedIn: string
  readonly note: string | null
  /** True when the line was copied from the previous month and has no row yet. */
  readonly draft: boolean
  /**
   * The whole-window figures when this line is a window spanning several
   * months, otherwise `null`. For a window, `planned` is the funded amount in
   * the month the window starts and zero after it, `carriedIn` is what is left
   * coming into the month, and `used`, `pace` and `health` are judged over the
   * whole window rather than the month.
   */
  readonly window: LineWindow | null
}
