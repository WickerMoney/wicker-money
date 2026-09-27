import type { ThemePreference } from './ThemePreference.js'

/**
 * Applies a theme to the document.
 *
 * `light` and `dark` set `data-theme` on the root element, which `tokens.css`
 * uses to override the operating system's preference. `system` removes the
 * attribute so the `prefers-color-scheme` media query decides again.
 *
 * @param preference - The theme to apply.
 * @param root - The element carrying the attribute; the document root by default.
 */
export function applyTheme(
  preference: ThemePreference,
  root: HTMLElement = document.documentElement,
): void {
  if (preference === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', preference)
}
