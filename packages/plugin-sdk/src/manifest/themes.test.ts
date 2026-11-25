import { describe, expect, it } from 'vitest'
import { SDK_MAJOR_VERSION, parseManifest } from '../index.js'
import { THEME_COLOR_TOKENS, THEME_LENGTH_TOKENS, isAllowedThemeValue } from './themeTokens.js'

const RLO = String.fromCharCode(0x202e)
const NUL = String.fromCharCode(0)

const base = {
  id: 'acme.themes',
  name: 'Themes',
  version: '1.0.0',
  sdkVersion: SDK_MAJOR_VERSION,
  remoteEntry: '/plugins/acme-themes/remoteEntry.js',
}

const theme = (over: Record<string, unknown> = {}) => ({
  id: 'midnight', label: 'Midnight', mode: 'dark', tokens: { '--wm-bg': '#0b0d12', '--wm-accent': 'rgb(120 200 255)' }, ...over,
})
const withThemes = (themes: unknown) => parseManifest({ ...base, contributes: { themes } })

describe('contributes.themes', () => {
  it('is optional: a manifest without it parses and the field stays absent', () => {
    const { manifest, error } = parseManifest(base)
    expect(error).toBeUndefined()
    expect(manifest?.contributes.themes).toBeUndefined()
    expect(parseManifest({ ...base, contributes: {} }).manifest?.contributes.themes).toBeUndefined()
  })

  it('accepts a valid theme and keeps it exactly', () => {
    const t = theme()
    expect(withThemes([t]).manifest?.contributes.themes).toEqual([t])
  })

  it('accepts every allowed token with a valid value, and an empty list', () => {
    const tokens: Record<string, string> = {}
    for (const n of THEME_COLOR_TOKENS) tokens[n] = '#abc'
    for (const n of THEME_LENGTH_TOKENS) tokens[n] = '8px'
    expect(withThemes([theme({ tokens })]).error).toBeUndefined()
    expect(withThemes([]).manifest?.contributes.themes).toEqual([])
  })

  it.each([
    ['#fff'], ['#FFFF'], ['#2e500d'], ['#2e500dcc'],
    ['rgb(46, 80, 13)'], ['rgb(46 80 13)'], ['rgba(46, 80, 13, 0.5)'], ['rgb(46 80 13 / 50%)'], ['rgb(10% 20% 30%)'],
    ['hsl(120deg 50% 40%)'], ['hsla(120, 50%, 40%, 0.3)'], ['hsl(120 50% 40% / .5)'],
    ['var(--wm-surface)'],
  ])('accepts the colour %s', (value) => {
    expect(isAllowedThemeValue('--wm-accent', value)).toBe(true)
  })

  it.each([
    ['0'], ['8px'], ['0.5rem'], ['1.25em'], ['var(--wm-gap)'],
  ])('accepts the length %s', (value) => {
    expect(isAllowedThemeValue('--wm-radius', value)).toBe(true)
  })
})

describe('contributes.themes: every rejected shape', () => {
  const rejected = (themes: unknown, text?: string): void => {
    const { manifest, error } = withThemes(themes)
    expect(manifest).toBeUndefined()
    expect(error).toContain('contributes.themes')
    if (text !== undefined) expect(error).toContain(text)
  }

  it.each([
    ['themes that are not a list', { a: 1 }],
    ['a theme that is not an object', ['midnight']],
    ['a null theme', [null]],
    ['a theme with no id', [{ label: 'x', mode: 'dark', tokens: { '--wm-bg': '#000' } }]],
    ['a theme with no label', [{ id: 'x', mode: 'dark', tokens: { '--wm-bg': '#000' } }]],
    ['a theme with no mode', [{ id: 'x', label: 'x', tokens: { '--wm-bg': '#000' } }]],
    ['a theme with no tokens', [{ id: 'x', label: 'x', mode: 'dark' }]],
    ['a mode that is neither light nor dark', [theme({ mode: 'sepia' })]],
    ['a mode in the wrong case', [theme({ mode: 'Dark' })]],
    ['tokens that are an array', [theme({ tokens: ['#000'] })]],
    ['tokens that are null', [theme({ tokens: null })]],
    ['no tokens at all', [theme({ tokens: {} })]],
    ['a token value that is not a string', [theme({ tokens: { '--wm-bg': 5 } })]],
    ['an id with upper case', [theme({ id: 'Midnight' })]],
    ['an id with a space', [theme({ id: 'mid night' })]],
    ['an id with a double hyphen', [theme({ id: 'mid--night' })]],
    ['an id that starts with a hyphen', [theme({ id: '-midnight' })]],
    ['an id that is empty', [theme({ id: '' })]],
    ['an id over 40 characters', [theme({ id: 'a'.repeat(41) })]],
    ['an empty label', [theme({ label: '' })]],
    ['a label over 60 characters', [theme({ label: 'a'.repeat(61) })]],
    ['a label with a newline', [theme({ label: 'Mid\nnight' })]],
    ['a label with a NUL', [theme({ label: `Mid${NUL}night` })]],
    ['a label with a bidirectional override', [theme({ label: `Mid${RLO}thgin` })]],
    ['a label with surrounding spaces', [theme({ label: ' Midnight' })]],
  ])('refuses %s', (_what, themes) => { rejected(themes) })

  it.each([
    ['css', 'body { background: url(//evil.test) }'],
    ['url', 'https://evil.test/theme.css'],
    ['extends', 'wickermoney.other'],
    ['description', 'a theme'],
  ])('refuses an unknown field on a theme (%s) instead of dropping it', (key, value) => {
    rejected([theme({ [key]: value })])
  })

  it.each([
    ['an unknown token', '--wm-nope'],
    ['a token outside the set (shadow)', '--wm-shadow'],
    ['a token outside the set (font)', '--wm-font'],
    ['a token outside the set (a chart alias)', '--wm-chart-surface'],
    ['a token without the --wm- prefix', '--accent'],
    ['a non-token property', 'background'],
    ['a property that would escape the token set', 'background-image'],
    ['an empty name', ''],
    ['a name that tries to end the declaration', '--wm-bg;color'],
    ['a name that opens a block', '--wm-bg{'],
  ])('refuses %s as a token name', (_what, name) => {
    rejected([theme({ tokens: { [name]: '#000' } })], 'not a token a theme may set')
  })

  it('refuses a __proto__ token (zod drops the own key, leaving no token to apply)', () => {
    rejected([theme({ tokens: { ['__proto__']: '#000' } })])
  })

  it.each([
    ['a url()', 'url(https://evil.test/x.png)'],
    ['a url() with quotes', "url('data:image/svg+xml;base64,AAAA')"],
    ['a url() in upper case', 'URL(x)'],
    ['an escaped url()', 'u\\72l(x)'],
    ['a var() of an arbitrary name', 'var(--secret)'],
    ['a var() of a name outside the set', 'var(--wm-shadow)'],
    ['a var() with a fallback', 'var(--wm-surface, red)'],
    ['a var() of a length token for a colour', 'var(--wm-gap)'],
    ['a semicolon', '#000; color: red'],
    ['a closing brace', '#000 }'],
    ['an opening brace', '{#000'],
    ['a second declaration', '#000;--wm-text:#fff'],
    ['a comment', '#000 /* x */'],
    ['an @import', '@import "x"'],
    ['an expression()', 'expression(alert(1))'],
    ['a calc()', 'calc(1px + 2px)'],
    ['a named colour', 'red'],
    ['a keyword', 'inherit'],
    ['an empty value', ''],
    ['a space', ' '],
    ['surrounding spaces', ' #000 '],
    ['a newline', '#000\n'],
    ['a bad hex length', '#12345'],
    ['a hex with a non-digit', '#12g'],
    ['a colour function with a letter inside', 'rgb(1 2 x)'],
    ['a colour function with too many numbers', 'rgb(1 2 3 4 5)'],
    ['a colour function with too few numbers', 'rgb(1 2)'],
    ['an unclosed colour function', 'rgb(1 2 3'],
    ['an unknown colour function', 'color-mix(in srgb, red, blue)'],
    ['a nested function', 'rgb(var(--wm-bg) 2 3)'],
    ['a value over 64 characters', '#' + 'a'.repeat(64)],
  ])('refuses %s as a colour value', (_what, value) => {
    expect(isAllowedThemeValue('--wm-accent', value)).toBe(false)
    rejected([theme({ tokens: { '--wm-accent': value } })], 'Not an allowed value for --wm-accent')
  })

  it.each([
    ['a colour', '#fff'],
    ['a negative length', '-8px'],
    ['a length with a bad unit', '8pt'],
    ['a length in vw', '100vw'],
    ['a bare number other than zero', '8'],
    ['a url()', 'url(x)'],
    ['a semicolon', '8px;'],
    ['a var() of a colour token', 'var(--wm-bg)'],
    ['a calc()', 'calc(8px)'],
    ['a huge number', '99999px'],
    ['a list', '8px 8px'],
  ])('refuses %s as a length value', (_what, value) => {
    expect(isAllowedThemeValue('--wm-radius', value)).toBe(false)
    rejected([theme({ tokens: { '--wm-radius': value } })], 'Not an allowed value for --wm-radius')
  })

  it('refuses more than 8 themes', () => {
    const many = Array.from({ length: 9 }, (_, i) => theme({ id: `t${i}` }))
    rejected(many)
    expect(withThemes(many.slice(0, 8)).error).toBeUndefined()
  })

  it('refuses two themes with the same id', () => {
    rejected([theme(), theme({ label: 'Again' })], "Duplicate theme id 'midnight'")
  })

  it('the 16 KiB backstop is unreachable with valid values today, and stays a backstop', () => {
    const full: Record<string, string> = {}
    for (const n of THEME_COLOR_TOKENS) full[n] = 'rgba(100.1234, 100.1234, 100.1234, 100.1234)'.slice(0, 64)
    for (const n of THEME_LENGTH_TOKENS) full[n] = '999.999rem'
    const biggest = Array.from({ length: 8 }, (_, i) => theme({ id: `t${i}`, label: 'L'.repeat(60), tokens: full }))
    const { manifest, error } = withThemes(biggest)
    const size = JSON.stringify(biggest).length
    if (size > 16 * 1024) expect(error).toContain('characters together')
    else expect(manifest !== undefined || error !== undefined).toBe(true)
  })

  it('a theme refused by a validator does not stop parseManifest from reporting, and never throws', () => {
    expect(() => withThemes([{ id: 1, label: {}, mode: [], tokens: 'x' }])).not.toThrow()
    expect(withThemes([{ id: 1, label: {}, mode: [], tokens: 'x' }]).error).toBeDefined()
  })

  it('does not let a theme change anything else in the manifest', () => {
    const { manifest } = withThemes([theme()])
    expect(manifest?.contributes.pages).toEqual([])
    expect(manifest?.contributes.widgets).toEqual([])
    expect(manifest?.permissions).toEqual([])
  })
})
