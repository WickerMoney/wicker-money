import type { HostTheme } from './protocol.js'

/** The part of an element `applyHostTheme` writes to. An `HTMLElement` satisfies it. */
export interface ThemeTarget {
  setAttribute(name: string, value: string): void
  readonly style: {
    setProperty(name: string, value: string): void
    removeProperty(name: string): unknown
  }
}

/** Tokens written per target, so a later theme can remove the ones it no longer defines. */
const applied = new WeakMap<object, Set<string>>()

/**
 * Applies the host's theme to a frame's root element: sets `data-theme` to the
 * scheme and each design token as a CSS custom property. Tokens a previous call
 * set that the new theme no longer has are removed.
 *
 * A frame cannot inherit custom properties from the host page, so the host
 * sends them and this writes them. `connectToHost` calls it for you on `init`
 * and on every theme change; call it yourself only if you opted out.
 *
 * @param theme - The theme from the host.
 * @param root - The element to style. Defaults to `document.documentElement`.
 * @throws {TypeError} When there is no `root` and no `document`.
 */
export function applyHostTheme(theme: HostTheme, root?: ThemeTarget): void {
  const target = root ?? (typeof document === 'undefined' ? undefined : document.documentElement)
  if (target === undefined) throw new TypeError('applyHostTheme needs a root element outside a browser')
  const before = applied.get(target) ?? new Set<string>()
  const now = new Set<string>()
  target.setAttribute('data-theme', theme.scheme)
  for (const [name, value] of Object.entries(theme.tokens)) {
    target.style.setProperty(name, value)
    now.add(name)
  }
  for (const name of before) if (!now.has(name)) target.style.removeProperty(name)
  applied.set(target, now)
}
