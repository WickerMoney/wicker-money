import type { ReadoutRow } from './ReadoutRow.js'

/** Everything a month says in words: the tooltip's lines and the screen-reader description. */
export interface MonthReadout {
  /** The month as `YYYY-MM`. */
  readonly month: string
  /** The categories that spent anything, largest stack segment first (top of the bar down). */
  readonly rows: readonly ReadoutRow[]
  /** Net spending across the shown categories, an exact four-decimal string. */
  readonly total: string
  /** The month's figures as a sentence, for assistive technology and the native tooltip. */
  readonly description: string
}
