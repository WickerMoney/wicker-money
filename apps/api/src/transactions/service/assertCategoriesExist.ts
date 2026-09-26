import { ValidationError } from '../../errors.js'
import type { TransactionRepository } from '../repository/TransactionRepository.js'

/**
 * Confirms every referenced category exists and belongs to the user.
 *
 * Checked up front so a foreign or unknown id is a clean 400 rather than a
 * foreign-key violation surfacing as a 500. The category is a reference inside
 * an otherwise addressable request, so it is reported as an invalid value
 * instead of a missing resource.
 *
 * @param transactions - Repository used for the lookup.
 * @param ids - Category ids; null and undefined entries are ignored.
 * @throws {ValidationError} If any id does not resolve to one of the user's categories.
 */
export async function assertCategoriesExist(
  transactions: Pick<TransactionRepository, 'findCategoryIds'>,
  ids: readonly (string | null | undefined)[],
): Promise<void> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null && id !== undefined))]
  if (wanted.length === 0) return
  const found = await transactions.findCategoryIds(wanted)
  if (wanted.some((id) => !found.has(id))) throw new ValidationError('Category not found.')
}
