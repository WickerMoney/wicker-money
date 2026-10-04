import { mappingIssues, type SourceMapping } from '../../../shared/index.js'
import { AMOUNT_STYLES, DATE_FORMATS } from '../../../shared/fields.js'
import { ImportError } from '../../service/ImportError.js'
import type { MappingBody } from './MappingBody.js'

/**
 * Validates a source mapping arriving from the browser.
 *
 * `dateFormat` is checked against the known list rather than accepted as free
 * text: it decides how every date in the file is read, and an unrecognised
 * value that silently fell back to a default would mean guessing dates. A
 * missing `amountStyle` defaults to `signed`.
 *
 * @param body - The unvalidated mapping fields from the request.
 * @returns The validated mapping, with `sourceName` trimmed.
 * @throws {ImportError} `400` when the source name is empty or over 120
 *   characters, `dateFormat` or `amountStyle` is not a known value, `columns`
 *   is missing or holds a non-string value, or `columns.date` or
 *   `columns.merchant` is absent.
 */
export function readMapping(body: MappingBody): SourceMapping {
  const sourceName = typeof body.sourceName === 'string' ? body.sourceName.trim() : ''
  if (typeof body.dateFormat !== 'string' || !(DATE_FORMATS as readonly string[]).includes(body.dateFormat)) {
    throw ImportError.field(['dateFormat'], `Must be one of: ${DATE_FORMATS.join(', ')}.`)
  }
  const amountStyle = typeof body.amountStyle === 'string' ? body.amountStyle : 'signed'
  if (!(AMOUNT_STYLES as readonly string[]).includes(amountStyle)) {
    throw ImportError.field(['amountStyle'], `Must be one of: ${AMOUNT_STYLES.join(', ')}.`)
  }
  if (typeof body.columns !== 'object' || body.columns === null) {
    throw ImportError.field(['columns'], 'This is required.')
  }
  const columns = body.columns as Record<string, unknown>
  for (const [key, value] of Object.entries(columns)) {
    if (value !== undefined && typeof value !== 'string') {
      throw ImportError.field(['columns', key], 'Must be a column name.')
    }
  }
  // The rules a person can break by what they choose or type, shared with
  // the page so it refuses the same things first.
  const issues = mappingIssues({
    sourceName,
    columns: {
      date: typeof columns['date'] === 'string' ? columns['date'] : '',
      merchant: typeof columns['merchant'] === 'string' ? columns['merchant'] : '',
    },
  })
  if (issues.length > 0) {
    throw new ImportError(issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 400, 'import_failed', issues)
  }

  return {
    sourceName,
    columns: columns as unknown as SourceMapping['columns'],
    dateFormat: body.dateFormat as SourceMapping['dateFormat'],
    amountStyle: amountStyle as SourceMapping['amountStyle'],
    invertAmount: body.invertAmount === true,
  }
}
