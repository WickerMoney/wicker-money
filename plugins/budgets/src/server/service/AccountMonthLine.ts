import type { LineStatus } from '../../shared/index.js'

/**
 * One account line as the month endpoint reports it: the same figures as a
 * category line, plus the account it measures.
 *
 * `categoryId` holds `account:<accountId>` and `categoryName` the label shown
 * on the tile, so the shared status shape, the bars and the ranking all work
 * unchanged. Use `accountId` for anything that needs the account itself.
 */
export interface AccountMonthLine extends LineStatus {
  /** Null while this line is only a draft; nothing is written until it is edited. */
  readonly id: string | null
  readonly accountId: string
  readonly accountName: string
  /** The balance brought in from earlier months, as a decimal string. */
  readonly carriedIn: string
  /** Categories whose spending does not count against the line. */
  readonly excludedCategoryIds: readonly string[]
  readonly note: string | null
  /** True when the line was copied from the previous month and has no row yet. */
  readonly draft: boolean
}
