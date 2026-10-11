import type { DebtRow } from './DebtRow.js'
import type { ExportedDebt } from './ExportedDebt.js'
import type { NewDebt } from './NewDebt.js'

/** The user's debts. Every method sees only the signed-in user's rows. */
export interface DebtRepository {
  /**
   * @param includeArchived - Whether archived debts are listed too.
   * @returns The debts in the person's own order: sort order, then oldest first, then id.
   */
  list(includeArchived: boolean): Promise<DebtRow[]>

  /** @returns The debt, or `undefined` if the user has none with that id. */
  find(id: string): Promise<DebtRow | undefined>

  /** As {@link find}, and locks the row until the transaction ends, for a read-then-write. */
  findForUpdate(id: string): Promise<DebtRow | undefined>

  /** @returns How many debts are not archived. */
  countActive(): Promise<number>

  /** @returns The new debt, or `undefined` if no row came back. */
  insert(debt: NewDebt): Promise<DebtRow | undefined>

  /**
   * Replaces every editable field of a debt.
   *
   * @returns The debt as saved, or `undefined` if the user has none with that id.
   */
  replace(id: string, debt: Omit<NewDebt, 'sortOrder'> & { readonly sortOrder: number }): Promise<DebtRow | undefined>

  /** @returns How many rows were deleted: 0 or 1. */
  delete(id: string): Promise<number>

  /** @returns Every debt, archived included, with its timestamps, for the data export. */
  listAll(): Promise<ExportedDebt[]>
}
