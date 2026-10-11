import type { AuthService } from '../../auth/service.js'
import type { Config } from '../../config.js'

/** Collaborators of {@link EraseService} beyond the unit of work. */
export interface EraseServiceDeps {
  /** Checks the password typed to confirm. */
  readonly auth: Pick<AuthService, 'confirmPassword'>
  /** The settings that decide whether an erased instance can be set up again. */
  readonly config: Pick<Config, 'DATABASE_URL' | 'REGISTRATION_ENABLED' | 'BOOTSTRAP_OWNER_EMAIL'>
}
