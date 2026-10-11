import type { ImportService } from '../../service/ImportService.js'
import { IMPORT_BODY_LIMIT } from '../helpers/IMPORT_BODY_LIMIT.js'
import type { ImportRouteDeps } from '../helpers/ImportRouteDeps.js'
import { readAnalyzeRequest } from '../helpers/readAnalyzeRequest.js'

/**
 * Registers `POST /analyze`: parses and classifies a CSV without writing
 * anything.
 *
 * Responds `200` with `{ summary, errors, rows }` (at most 50 row errors are
 * returned; the summary carries the full error count). Responds `400` for an
 * invalid account id, mapping or CSV, or a file over the row limit (`IMPORT_MAX_ROWS`); `404` when
 * the account is not visible to the user; and `413` when the body exceeds 10 MiB.
 *
 * The route is `longRunning`: it runs under the host's long statement limit,
 * because it reads the account's existing transactions across the file's
 * whole date range in one statement.
 *
 * @param deps - The host's `route` registrar.
 * @param service - The import service.
 */
export function registerAnalyzeImport({ route }: Pick<ImportRouteDeps, 'route'>, service: ImportService): void {
  route(
    'POST',
    '/analyze',
    ({ userId, body }) => service.analyze(userId, readAnalyzeRequest(body)),
    { bodyLimit: IMPORT_BODY_LIMIT, longRunning: true },
  )
}
