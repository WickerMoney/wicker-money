import type { AnalyzeInput } from '../../service/AnalyzeInput.js'
import type { AnalyzeBody } from './AnalyzeBody.js'
import { readCsv } from './readCsv.js'
import { readMapping } from './readMapping.js'
import { readUuid } from './readUuid.js'

/**
 * Validates an analyze request body.
 *
 * The file is `body.csv`, or `staged` when the request named an upload and the
 * route has already fetched its text. Either way the text goes through
 * {@link readCsv}, so an inline and a staged file are held to the same rules.
 *
 * @param body - The parsed JSON body, unvalidated.
 * @param staged - The text of the staged upload the body's `uploadId` names, when it has one.
 * @returns The account, CSV text and mapping.
 * @throws {ImportError} `400` for an invalid account id, mapping or CSV.
 */
export function readAnalyzeRequest(body: unknown, staged?: string): AnalyzeInput {
  const b = (body ?? {}) as AnalyzeBody
  return {
    accountId: readUuid(b.accountId, 'accountId'),
    mapping: readMapping(b),
    csv: readCsv(staged === undefined ? b : { csv: staged }),
  }
}
