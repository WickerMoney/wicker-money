import { LAST_OWNER_SQLSTATE, NO_SUCH_USER_SQLSTATE, OWNER_REQUIRED_SQLSTATE } from '../../db/migrations/029_owner_role_management.js'
import { OwnerRequiredError } from '../../auth/OwnerRequiredError.js'
import { NotFoundError } from '../../errors.js'
import { LastOwnerError } from '../LastOwnerError.js'

/**
 * Runs a call to one of the owner functions and turns the refusals they raise
 * into the API's own errors.
 *
 * Wrap only the single statement that calls the function: a failed statement
 * aborts the transaction, so the caller must let the error propagate and roll
 * back.
 *
 * @param call - The statement to run.
 * @returns Whatever `call` resolves to.
 * @throws {OwnerRequiredError} On `42501`: the caller is not (or is no longer) an owner.
 * @throws {NotFoundError} On `P0002`: no such account.
 * @throws {LastOwnerError} On `WM001`: the change would leave no owner.
 */
export async function translateRoleChangeError<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : undefined
    if (code === OWNER_REQUIRED_SQLSTATE) throw new OwnerRequiredError()
    if (code === NO_SUCH_USER_SQLSTATE) throw new NotFoundError('Account')
    if (code === LAST_OWNER_SQLSTATE) throw new LastOwnerError()
    throw error
  }
}
