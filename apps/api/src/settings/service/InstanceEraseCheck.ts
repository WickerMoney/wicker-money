import type { InstanceEraseBlocker } from './InstanceEraseBlocker.js'

/** What an owner is told before they can confirm "erase this instance". */
export interface InstanceEraseCheck {
  /** The database the instance keeps its data in, shown so the person knows which instance this is. */
  readonly databaseName: string
  /** Whether registration is open, which the first owner needs after the erase. */
  readonly registrationEnabled: boolean
  /** `BOOTSTRAP_OWNER_EMAIL`, or `null` when unset (the first registrant then becomes the owner). */
  readonly bootstrapOwnerEmail: string | null
  /** Live session families other than this one: other devices and other people. */
  readonly otherSessions: number
  /** Different accounts, besides this one, with a live session. */
  readonly otherUsers: number
  /** Why the erase is refused regardless of confirmation, or `null`. */
  readonly blocker: InstanceEraseBlocker
}
