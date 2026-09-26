import type { ImportService } from '../../service/ImportService.js'
import type { ImportRouteDeps } from '../helpers/ImportRouteDeps.js'

/**
 * Registers `GET /mappings`: the user's saved source mappings, so a returning
 * file needs no re-mapping.
 *
 * Responds `200` with `{ mappings }`, ordered case-insensitively by source name.
 *
 * @param deps - The host's `route` registrar.
 * @param service - The import service.
 */
export function registerListMappings({ route }: Pick<ImportRouteDeps, 'route'>, service: ImportService): void {
  route('GET', '/mappings', async ({ userId }) => ({ mappings: await service.listMappings(userId) }))
}
