/**
 * Domain logic shared by both halves of the plugin.
 *
 * The browser maps and previews with these; the server re-runs the same
 * functions on commit. Sharing the module is deliberate — a preview that
 * disagrees with what gets written is the one bug an import UI must not have.
 */
export { detectDelimiter, parseCsv, parseRows, type Delimiter, type ParsedCsv } from './csv.js'
export {
  AMOUNT_STYLES, DATE_FORMATS, defaultDateFormat, isDateFormat, negateMoney, parseDate,
  parseMoney, type AmountStyle, type DateFormat,
} from './fields.js'
export { mapParsedRows } from './mapParsedRows.js'
export { MAX_SOURCE_NAME, mappingIssues, type MappingIssue } from './mappingIssues.js'
export {
  mapRows, suggestAmountStyle, suggestColumns,
  type ColumnMap, type MapResult, type MappedRow, type RowError, type SourceMapping,
} from './mapping.js'
export {
  MATCH_WINDOW_DAYS, classifyRows, normalizeMoney, sameMoney, summarize,
  type ClassifiedRow, type ClassifySummary, type ExistingTransaction, type RowStatus,
} from './dedupe.js'
