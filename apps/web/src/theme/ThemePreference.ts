/** A theme choice: a fixed light or dark, or `system` to follow the operating system. */
export type ThemePreference = 'light' | 'dark' | 'system'

/** Every {@link ThemePreference}, in the order the theme menu lists them. */
export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system']

/**
 * Narrows an unknown value, such as one read back from storage, to a
 * {@link ThemePreference}.
 *
 * @param value - The value to test.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}
