import { AppError } from '../errors.js'

/** The change would leave the instance with no owner. HTTP 409, code `last_owner`. */
export class LastOwnerError extends AppError {
  constructor() {
    super(
      'An instance must keep at least one owner. Make another account an owner first.',
      409,
      'last_owner',
    )
  }
}
