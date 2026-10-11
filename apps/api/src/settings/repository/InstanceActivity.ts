/** Who else is signed in to the instance, as an owner sees it before erasing it. */
export interface InstanceActivity {
  /** Live session families other than the caller's current one: other devices and other people. */
  readonly otherSessions: number
  /** Different accounts, besides the caller's, that have at least one live session. */
  readonly otherUsers: number
}
