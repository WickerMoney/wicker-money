import type { Health } from '../../shared/index.js'
import type { LineWindow } from './LineWindow.js'

/** One budget line for one month, as returned by the month endpoint. */
export interface MonthLine {
  /** `null` for a draft line that has not been saved yet. */
  readonly id: string | null
  readonly categoryId: string
  readonly categoryName: string
  /** Decimal string. The amount the user planned to spend. */
  readonly planned: string
  /** Decimal string. Balance carried in from earlier months when the line rolls over. */
  readonly carriedIn: string
  /** Decimal string. `planned` plus `carriedIn`. */
  readonly available: string
  /** Decimal string. What has been spent in the category this month. */
  readonly spent: string
  /** Decimal string. `available` minus `spent`; negative when overspent. */
  readonly remaining: string
  /** `true` for a sinking-fund line whose leftover (or overspend) carries into the next month. */
  readonly rollover: boolean
  /** Fraction of `available` spent so far. Can exceed 1. */
  readonly used: number
  /** `used` divided by the fraction of the period elapsed; 1 is exactly on pace. */
  readonly pace: number
  /**
   * Fraction of the line's period elapsed: the month for a monthly line, the
   * whole window for a window. Absent from servers older than windows.
   */
  readonly elapsed?: number
  readonly health: Health
  readonly note: string | null
  /** `true` when the line is copied from the previous month and not yet saved. */
  readonly draft: boolean
  /**
   * Set when the line is a window spanning several months: funded once and
   * spent down. `planned` is then the funded amount in the window's first
   * month and zero after, `carriedIn` what is left coming into the month, and
   * `used`, `pace` and `health` are judged over the whole window. Absent or
   * `null` on a monthly line.
   */
  readonly window?: LineWindow | null
}
