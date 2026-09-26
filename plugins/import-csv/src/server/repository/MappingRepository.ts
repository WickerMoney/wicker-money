import type { SourceMapping } from '../../shared/index.js'
import type { SavedMappingRow } from './SavedMappingRow.js'

/** Storage of the user's saved source mappings. */
export interface MappingRepository {
  /**
   * Lists the user's saved mappings.
   *
   * @returns Every mapping, ordered case-insensitively by source name.
   */
  list(): Promise<SavedMappingRow[]>

  /**
   * Saves a mapping, replacing the settings of the one with the same source name
   * (compared case-insensitively). The stored name keeps its original spelling.
   *
   * @param mapping - The validated mapping.
   * @returns The id of the stored row, or `undefined` if the database returned none.
   */
  save(mapping: SourceMapping): Promise<string | undefined>
}
