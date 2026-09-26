import type { AnalyzeInput } from '../../service/AnalyzeInput.js'
import type { AnalyzeBody } from './AnalyzeBody.js'
import { readCsv } from './readCsv.js'
import { readMapping } from './readMapping.js'
import { readUuid } from './readUuid.js'

/**
 * Validates an analyze request body.
 *
 * @param body - The parsed JSON body, unvalidated.
 * @returns The account, CSV text and mapping.
 * @throws {ImportError} `400` for an invalid account id, mapping or CSV.
 */
export function readAnalyzeRequest(body: unknown): AnalyzeInput {
  const b = (body ?? {}) as AnalyzeBody
  return {
    accountId: readUuid(b.accountId, 'accountId'),
    mapping: readMapping(b),
    csv: readCsv(b),
  }
}
