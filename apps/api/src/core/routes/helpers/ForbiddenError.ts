import { AppError } from '../../../errors.js'

/** Raised when a plugin's request is refused: responds `403` with code `grant_denied`. */
export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(message, 403, 'grant_denied')
  }
}
