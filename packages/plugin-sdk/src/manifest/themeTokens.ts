/**
 * The custom properties a plugin theme may set, by the syntax their value may have. A fixed set, so a theme is data
 * and never a way to inject CSS: `contributes.themes` can name nothing outside it.
 *
 * Colours are the app's surface, text, accent and status colours and its chart palette. Lengths are the corner radii
 * and the two spacing steps. Shadows, fonts and the chart aliases (`--wm-chart-surface`, `--wm-chart-ink`,
 * `--wm-chart-ink-muted`, which are `var()` references to other tokens) are left out on purpose: their values are
 * lists or references, which is the syntax a validator cannot keep safe.
 */
export const THEME_COLOR_TOKENS = [
  '--wm-bg',
  '--wm-surface',
  '--wm-surface-alt',
  '--wm-border',
  '--wm-text',
  '--wm-text-muted',
  '--wm-accent',
  '--wm-accent-text',
  '--wm-positive',
  '--wm-negative',
  '--wm-warning',
  '--wm-chart-1',
  '--wm-chart-2',
  '--wm-chart-3',
  '--wm-chart-4',
  '--wm-chart-5',
  '--wm-chart-6',
  '--wm-chart-other',
  '--wm-chart-grid',
] as const

/** Length tokens: the two corner radii and the two spacing steps. */
export const THEME_LENGTH_TOKENS = ['--wm-radius', '--wm-radius-sm', '--wm-gap', '--wm-gap-sm'] as const

/** Longest value a theme token may have, in characters. */
export const MAX_THEME_VALUE_LENGTH = 64
/** Most themes one manifest may declare. */
export const MAX_THEMES_PER_PLUGIN = 8
/** Most characters of JSON all of one manifest's themes may take together. */
export const MAX_THEMES_JSON_LENGTH = 16 * 1024

const COLOR_TOKEN_SET: ReadonlySet<string> = new Set(THEME_COLOR_TOKENS)
const LENGTH_TOKEN_SET: ReadonlySet<string> = new Set(THEME_LENGTH_TOKENS)

const NUMBER = String.raw`[+-]?(?:\d{1,3}(?:\.\d{1,4})?|\.\d{1,4})`
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
// rgb(), rgba(), hsl(), hsla(): three or four numbers, each optionally a percentage or an angle, separated by commas,
// spaces or a slash. Only digits, signs, dots, `%`, `deg`, spaces, commas and a slash can appear between the brackets.
const COLOR_FUNCTION = new RegExp(
  String.raw`^(?:rgb|rgba|hsl|hsla)\(\s*${NUMBER}(?:%|deg)?(?:\s*[,/]\s*|\s+)${NUMBER}%?(?:\s*[,/]\s*|\s+)${NUMBER}%?(?:\s*[,/]\s*${NUMBER}%?|\s+/\s+${NUMBER}%?)?\s*\)$`,
  'i',
)
const LENGTH = /^(?:0|\d{1,3}(?:\.\d{1,3})?(?:px|rem|em))$/
const VAR = /^var\((--wm-[a-z0-9-]{1,30})\)$/

/**
 * Whether `value` is allowed for the token `name`.
 *
 * A colour token takes a hex colour (3, 4, 6 or 8 digits), `rgb()`, `rgba()`, `hsl()` or `hsla()` of plain numbers,
 * or `var()` of another colour token in this set. A length token takes `0` or a number with `px`, `rem` or `em`, or
 * `var()` of another length token. Nothing else: no `url(`, no `;`, no braces, no comments, no other function, no
 * keyword, no `var()` of a name outside the set. The value is also capped at {@link MAX_THEME_VALUE_LENGTH}.
 *
 * @param name - A token name from {@link THEME_COLOR_TOKENS} or {@link THEME_LENGTH_TOKENS}.
 * @param value - The proposed value.
 * @returns `true` when the value is allowed.
 */
export function isAllowedThemeValue(name: string, value: string): boolean {
  if (value.length === 0 || value.length > MAX_THEME_VALUE_LENGTH || value !== value.trim()) return false
  const ref = VAR.exec(value)
  if (ref !== null) {
    const target = ref[1] as string
    return COLOR_TOKEN_SET.has(name) ? COLOR_TOKEN_SET.has(target) : LENGTH_TOKEN_SET.has(name) && LENGTH_TOKEN_SET.has(target)
  }
  if (COLOR_TOKEN_SET.has(name)) return HEX.test(value) || COLOR_FUNCTION.test(value)
  if (LENGTH_TOKEN_SET.has(name)) return LENGTH.test(value)
  return false
}

/** Whether `name` is a token a theme may set. */
export const isThemeToken = (name: string): boolean => COLOR_TOKEN_SET.has(name) || LENGTH_TOKEN_SET.has(name)
