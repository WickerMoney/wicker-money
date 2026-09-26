/**
 * A source mapping as it arrives from the browser, before validation.
 *
 * Every field is `unknown` because nothing has been checked yet; `readMapping`
 * narrows it into a `SourceMapping`.
 */
export interface MappingBody {
  sourceName?: unknown
  columns?: unknown
  dateFormat?: unknown
  amountStyle?: unknown
  invertAmount?: unknown
}
