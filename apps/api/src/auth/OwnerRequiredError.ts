import { AppError } from '../errors.js'

/** The caller is signed in but is not an instance owner. HTTP 403, code `owner_required`. */
export class OwnerRequiredError extends AppError {
  constructor() {
    super('Only an owner of this Wicker Money instance can do this.', 403, 'owner_required')
  }
}
