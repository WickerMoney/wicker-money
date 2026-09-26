import type { ImportService } from '../../service/ImportService.js'
import type { ImportRouteDeps } from '../helpers/ImportRouteDeps.js'

/**
 * Registers `GET /batches`: the user's 25 most recent import batches, newest
 * first, each with its account name.
 *
 * Responds `200` with `{ batches }`.
 *
 * @param deps - The host's `route` registrar.
 * @param service - The import service.
 */
export function registerListBatches({ route }: Pick<ImportRouteDeps, 'route'>, service: ImportService): void {
  route('GET', '/batches', async ({ userId }) => ({ batches: await service.listBatches(userId) }))
}
