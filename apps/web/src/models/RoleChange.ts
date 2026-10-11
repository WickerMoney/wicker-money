import type { Person } from './Person.js'

/** The API's answer to changing an account's role. */
export interface RoleChange {
  /** The account as it now is. */
  readonly user: Person
  /** Its role before the request. */
  readonly previous: { readonly role: 'owner' | 'member' }
  /** Whether the request changed anything. */
  readonly changed: boolean
  /** Who made the request. */
  readonly changedBy: { readonly id: string; readonly email: string }
  /** When, as an ISO timestamp. */
  readonly changedAt: string
}
