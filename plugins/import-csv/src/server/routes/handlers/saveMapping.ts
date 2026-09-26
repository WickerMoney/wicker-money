import type { ImportService } from '../../service/ImportService.js'
import type { ImportRouteDeps } from '../helpers/ImportRouteDeps.js'
import type { MappingBody } from '../helpers/MappingBody.js'
import { readMapping } from '../helpers/readMapping.js'

/**
 * Registers `POST /mappings`: saves a source mapping, replacing any existing
 * mapping with the same name (compared case-insensitively).
 *
 * Responds `200` with `{ id, saved: true }`, or `400` when the mapping fails
 * validation.
 *
 * @param deps - The host's `route` registrar.
 * @param service - The import service.
 */
export function registerSaveMapping({ route }: Pick<ImportRouteDeps, 'route'>, service: ImportService): void {
  route('POST', '/mappings', async ({ userId, body }) => {
    const id = await service.saveMapping(userId, readMapping((body ?? {}) as MappingBody))
    return { id, saved: true }
  })
}
