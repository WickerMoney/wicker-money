/**
 * Capabilities beyond table access that a plugin may ask the host for.
 *
 * - `network:outbound` - make outgoing network requests.
 * - `schedule:daily` - run work once a day.
 * - `notify` - send the user notifications.
 */
export const PERMISSIONS = ['network:outbound', 'schedule:daily', 'notify'] as const
