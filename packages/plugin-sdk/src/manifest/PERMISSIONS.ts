/**
 * Capabilities beyond table access that a plugin may ask the host for.
 *
 * These are declarations only. Nothing in the host enforces them yet, so a
 * plugin that omits one is not prevented from doing the thing it names.
 *
 * - `network:outbound` - make outgoing network requests.
 * - `schedule:daily` - run work once a day.
 * - `notify` - send the user notifications.
 */
export const PERMISSIONS = ['network:outbound', 'schedule:daily', 'notify'] as const
