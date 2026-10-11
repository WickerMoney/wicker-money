import type { HostLocale, HostTheme } from '@wickermoney/plugin-sdk/isolated'

/** Most tokens sent in one theme; the SDK refuses more. */
const MAX_TOKENS = 512
/** Longest token value sent; the SDK refuses longer. */
const MAX_VALUE_LENGTH = 512
/** The design tokens a frame needs, by prefix. Nothing else on the page is exposed. */
const TOKEN_PREFIX = '--wm-'

/** Names of the custom properties the page's stylesheets and the root's inline style define. */
function tokenNames(root: HTMLElement): Set<string> {
  const names = new Set<string>()
  const collect = (style: CSSStyleDeclaration): void => {
    for (let i = 0; i < style.length; i++) {
      const name = style.item(i)
      if (name.startsWith(TOKEN_PREFIX)) names.add(name)
    }
  }
  const visit = (rules: CSSRuleList): void => {
    for (const rule of Array.from(rules)) {
      if ('style' in rule && (rule as CSSStyleRule).style !== undefined) collect((rule as CSSStyleRule).style)
      // Media rules and layers nest the token definitions in dark-mode blocks.
      if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules)
    }
  }
  for (const sheet of Array.from(root.ownerDocument.styleSheets)) {
    // A stylesheet from another origin refuses to be read; it is not ours to theme from.
    try { visit(sheet.cssRules) } catch { /* cross-origin sheet */ }
  }
  collect(root.style)
  return names
}

/**
 * Reads the host's current theme: the scheme in effect and the resolved value
 * of every `--wm-*` design token.
 *
 * The values are the computed ones, so they already reflect `data-theme` and
 * the operating system's preference. A frame cannot inherit custom properties
 * from this page, which is why the host sends them.
 *
 * @param root - The element carrying `data-theme`. Defaults to the document root.
 * @returns The scheme and tokens, within the limits the SDK enforces.
 */
export function readHostTheme(root: HTMLElement = document.documentElement): HostTheme {
  const attr = root.getAttribute('data-theme')
  const view = root.ownerDocument.defaultView
  const scheme: HostTheme['scheme'] = attr === 'dark' || attr === 'light'
    ? attr
    : view?.matchMedia?.('(prefers-color-scheme: dark)').matches === true ? 'dark' : 'light'
  const computed = view?.getComputedStyle(root)
  const tokens: Record<string, string> = {}
  let count = 0
  for (const name of [...tokenNames(root)].sort()) {
    if (count >= MAX_TOKENS) break
    const value = (computed?.getPropertyValue(name) ?? root.style.getPropertyValue(name)).trim()
    if (value === '' || value.length > MAX_VALUE_LENGTH) continue
    tokens[name] = value
    count += 1
  }
  return { scheme, tokens }
}

/**
 * The locale and time zone frames should format with.
 *
 * @param timezone - The signed-in user's time zone, from their profile.
 * @returns The browser's language, as `formatMoney` and `formatDate` use, and that time zone.
 */
export function readHostLocale(timezone: string): HostLocale {
  return { locale: typeof navigator === 'undefined' ? 'en-US' : navigator.language || 'en-US', timezone }
}
