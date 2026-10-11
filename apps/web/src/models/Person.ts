/** An account on this instance, as an owner sees it when managing roles. */
export interface Person {
  /** The account's id. */
  readonly id: string
  /** The sign-in email address. */
  readonly email: string
  /** What the account may do on this instance. */
  readonly role: 'owner' | 'member'
  /** When the account was created, as an ISO timestamp. */
  readonly createdAt: string
}
