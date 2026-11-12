import { QueryImportUnitOfWork } from '../repository/QueryImportUnitOfWork.js'
import { ImportGate } from '../service/ImportGate.js'
import { ImportService } from '../service/ImportService.js'
import { registerAnalyzeImport } from './handlers/analyzeImport.js'
import { registerCommitImport } from './handlers/commitImport.js'
import { registerListBatches } from './handlers/listBatches.js'
import { registerListMappings } from './handlers/listMappings.js'
import { registerRevertBatch } from './handlers/revertBatch.js'
import { registerSaveMapping } from './handlers/saveMapping.js'
import { registerUploadAbort } from './handlers/uploadAbort.js'
import { registerUploadBegin } from './handlers/uploadBegin.js'
import { registerUploadChunk } from './handlers/uploadChunk.js'
import { registerUploadFinish } from './handlers/uploadFinish.js'
import { UploadStore } from '../staging/UploadStore.js'
import type { ImportRouteDeps } from './helpers/ImportRouteDeps.js'

export { IMPORT_API_BASE } from '../constants.js'
export { ImportError } from '../service/ImportError.js'
export { ImportBusyError } from '../service/ImportBusyError.js'
export type { ImportRouteDeps } from './helpers/ImportRouteDeps.js'

/**
 * Registers every CSV import endpoint through the host-supplied route registrar.
 *
 * Also creates the in-memory store for staged uploads (`/upload/begin`,
 * `/upload/chunk`, `/upload/finish`, `/upload/abort`; `analyze` and `commit` accept its ids).
 *
 * @param deps - The host's `route` registrar, `runAsPlugin` runner, the
 *   category rule loader and resolver used when committing an import, and its
 *   row and concurrency limits.
 */
export function registerImportRoutes(deps: ImportRouteDeps): void {
  const uow = new QueryImportUnitOfWork(deps.runAsPlugin, deps.getRulesForMatching)
  const service = new ImportService(uow, deps.resolveCategory, deps.maxRows, {
    commit: new ImportGate(deps.maxConcurrent, deps.queueWaitMs),
  })
  registerListMappings(deps, service)
  registerSaveMapping(deps, service)
  // Staged uploads live in this process's memory, one store per registration.
  const uploads = new UploadStore()
  registerUploadBegin(deps, uploads)
  registerUploadChunk(deps, uploads)
  registerUploadFinish(deps, uploads)
  registerUploadAbort(deps, uploads)
  registerAnalyzeImport(deps, service, uploads)
  registerCommitImport(deps, service, uploads)
  registerListBatches(deps, service)
  registerRevertBatch(deps, service)
}
