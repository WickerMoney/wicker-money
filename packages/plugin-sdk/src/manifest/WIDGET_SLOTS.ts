/**
 * Places in the application shell where a widget may mount.
 *
 * - `dashboard.primary` - the main area of the dashboard.
 * - `dashboard.secondary` - the secondary area of the dashboard.
 * - `account.detail` - the detail view of a single account.
 */
export const WIDGET_SLOTS = [
  'dashboard.primary',
  'dashboard.secondary',
  'account.detail',
] as const
