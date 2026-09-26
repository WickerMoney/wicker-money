import type { Health } from '../../shared/index.js'

/** Maps a line's health to the CSS modifier class that colours its bar and dot. */
export const HEALTH_CLASS: Record<Health, string> = {
  over: 'is-over',
  'at-risk': 'is-at-risk',
  ahead: 'is-ahead',
  'on-track': 'is-on-track',
  unused: 'is-unused',
}
