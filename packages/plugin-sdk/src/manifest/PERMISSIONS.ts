/**
 * Capabilities beyond table access that a plugin may ask the host for.
 *
 * The names are reserved. A host that cannot enforce a permission refuses a
 * manifest that declares it, with a message naming it, rather than loading the
 * plugin and ignoring the declaration. The Wicker Money host enforces only
 * `notify` (the broker gates the `notify` message on it); a manifest that lists
 * either of the other two does not load.
 *
 * - `network:outbound` - make outgoing network requests.
 * - `schedule:daily` - run work once a day.
 * - `notify` - raise short text toasts in the app, through `ctx.notify`.
 */
export const PERMISSIONS = ['network:outbound', 'schedule:daily', 'notify'] as const
