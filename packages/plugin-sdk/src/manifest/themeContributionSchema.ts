import { z } from 'zod'
import {
  isAllowedThemeValue, isThemeToken, MAX_THEME_VALUE_LENGTH, MAX_THEMES_JSON_LENGTH, MAX_THEMES_PER_PLUGIN,
} from './themeTokens.js'

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/

/**
 * Validates one entry of a manifest's `contributes.themes`: a colour theme made of design tokens and nothing else.
 *
 * Strict: a field that is not listed here (a `css` string, a `url`) is refused rather than dropped, so a theme cannot
 * carry anything a host might one day read. `tokens` may only name tokens from the fixed set in `themeTokens.ts`
 * (a subset is fine: the host lays the theme over its own light or dark base), and each value must pass
 * {@link isAllowedThemeValue}.
 */
export const themeContributionSchema = z.strictObject({
  /** Identifier of the theme, unique within the plugin: lowercase letters, digits and single hyphens. */
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be lowercase letters, digits and single hyphens').max(40),
  /** Name shown to the person who picks the theme. One line of plain text. */
  label: z.string().min(1).max(60).refine((s) => !CONTROL.test(s) && s.trim() === s, 'Must be one line of plain text without surrounding spaces'),
  /** Whether the theme is a light or a dark one, which tells the host which base to lay it over. */
  mode: z.enum(['light', 'dark']),
  /** Token name (a `--wm-*` custom property from the fixed set) to its value. At least one. */
  tokens: z.record(z.string(), z.string()).superRefine((tokens, ctx) => {
    const names = Object.keys(tokens)
    if (names.length === 0) ctx.addIssue({ code: 'custom', message: 'A theme needs at least one token' })
    for (const name of names) {
      if (!isThemeToken(name)) {
        ctx.addIssue({ code: 'custom', path: [name], message: `'${name.slice(0, 40)}' is not a token a theme may set` })
        continue
      }
      const value = tokens[name] as string
      if (!isAllowedThemeValue(name, value)) {
        ctx.addIssue({
          code: 'custom', path: [name],
          message: `Not an allowed value for ${name} (a colour such as #2e500d or rgb(46 80 13), a length such as 8px, or var() of another token of the same kind; at most ${MAX_THEME_VALUE_LENGTH} characters)`,
        })
      }
    }
  }),
})

/**
 * Validates a manifest's `contributes.themes` as a whole: at most {@link MAX_THEMES_PER_PLUGIN} themes, unique ids,
 * and no more than {@link MAX_THEMES_JSON_LENGTH} characters of JSON between them.
 *
 * Parsing and validating is all this does. The host registers and offers a theme in a later release; a host that
 * does not know the field ignores it.
 */
export const themesSchema = z.array(themeContributionSchema).max(MAX_THEMES_PER_PLUGIN).superRefine((themes, ctx) => {
  const seen = new Set<string>()
  themes.forEach((t, i) => {
    if (seen.has(t.id)) ctx.addIssue({ code: 'custom', path: [i, 'id'], message: `Duplicate theme id '${t.id}'` })
    seen.add(t.id)
  })
  if (JSON.stringify(themes).length > MAX_THEMES_JSON_LENGTH) {
    ctx.addIssue({ code: 'custom', message: `Themes take more than ${MAX_THEMES_JSON_LENGTH} characters together` })
  }
})
