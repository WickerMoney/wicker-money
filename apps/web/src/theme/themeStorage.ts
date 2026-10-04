import { isThemePreference, type ThemePreference } from './ThemePreference.js'

/**
 * Where the theme choice is remembered.
 *
 * `public/theme-init.js` (loaded from `index.html`) reads this same key to
 * apply the theme before first paint, so a change here must be made there too
 * (a test fails if they drift). It is one key per browser rather than one per
 * user, because that script runs before anyone has signed in.
 */
export const THEME_STORAGE_KEY = 'wickermoney.theme'

/**
 * Reads the theme the user last chose.
 *
 * @returns The remembered choice, or `system` when nothing valid is stored or
 *   storage is unavailable. Private windows and blocked site data throw on
 *   access rather than returning `null`.
 */
export function readThemePreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(saved) ? saved : 'system'
  } catch {
    return 'system'
  }
}

/**
 * Remembers the theme choice across visits. Failure is silently ignored, since
 * remembering the choice is a convenience rather than a requirement.
 *
 * @param preference - The choice to remember.
 */
export function writeThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Storage unavailable; the choice applies for this visit only.
  }
}
