import { QueryImportUnitOfWork } from '../repository/QueryImportUnitOfWork.js'
import { ImportService } from '../service/ImportService.js'
import { registerAnalyzeImport } from './handlers/analyzeImport.js'
import { registerCommitImport } from './handlers/commitImport.js'
import { registerListBatches } from './handlers/listBatches.js'
import { registerListMappings } from './handlers/listMappings.js'
import { registerRevertBatch } from './handlers/revertBatch.js'
import { registerSaveMapping } from './handlers/saveMapping.js'
import type { ImportRouteDeps } from './helpers/ImportRouteDeps.js'

export { IMPORT_API_BASE } from '../constants.js'
export { ImportError } from '../service/ImportError.js'
export type { ConditionForMatching } from '../repository/ConditionForMatching.js'
export type { Query } from '../repository/Query.js'
export type { RuleForMatching } from '../repository/RuleForMatching.js'
export type { ImportRouteDeps } from './helpers/ImportRouteDeps.js'
export type { RouteContext } from './helpers/RouteContext.js'

/**
 * Registers every CSV import endpoint through the host-supplied route registrar.
 *
 * @param deps - The host's `route` registrar, `runAsPlugin` runner, and the
 *   category rule loader and resolver used when committing an import.
 */
export function registerImportRoutes(deps: ImportRouteDeps): void {
  const uow = new QueryImportUnitOfWork(deps.runAsPlugin, deps.getRulesForMatching)
  const service = new ImportService(uow, deps.resolveCategory)
  registerListMappings(deps, service)
  registerSaveMapping(deps, service)
  registerAnalyzeImport(deps, service)
  registerCommitImport(deps, service)
  registerListBatches(deps, service)
  registerRevertBatch(deps, service)
}
