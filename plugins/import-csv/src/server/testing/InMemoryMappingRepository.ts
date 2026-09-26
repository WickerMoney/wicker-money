import type { SourceMapping } from '../../shared/index.js'
import type { MappingRepository } from '../repository/MappingRepository.js'
import type { SavedMappingRow } from '../repository/SavedMappingRow.js'
import type { InMemoryImportStore } from './InMemoryImportStore.js'

/** {@link MappingRepository} over an {@link InMemoryImportStore}, narrowed to one user. */
export class InMemoryMappingRepository implements MappingRepository {
  /**
   * @param store - The shared data.
   * @param userId - The user whose mappings are visible.
   */
  constructor(
    private readonly store: InMemoryImportStore,
    private readonly userId: string,
  ) {}

  /** @inheritdoc */
  async list(): Promise<SavedMappingRow[]> {
    return [...this.store.mappings.entries()]
      .filter(([key]) => key.startsWith(`${this.userId}|`))
      .map(([, row]) => row)
      .sort((a, b) => a.sourceName.toLowerCase().localeCompare(b.sourceName.toLowerCase()))
  }

  /** @inheritdoc */
  async save(mapping: SourceMapping): Promise<string | undefined> {
    const key = `${this.userId}|${mapping.sourceName.toLowerCase()}`
    const existing = this.store.mappings.get(key)
    const id = existing?.id ?? this.store.nextId('mapping')
    this.store.mappings.set(key, {
      id,
      sourceName: existing?.sourceName ?? mapping.sourceName,
      columns: mapping.columns as unknown as Record<string, string>,
      dateFormat: mapping.dateFormat,
      amountStyle: mapping.amountStyle,
      invertAmount: mapping.invertAmount,
    })
    return id
  }
}
