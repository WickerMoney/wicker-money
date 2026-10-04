import { afterEach, describe, expect, it, vi } from 'vitest'
import indexHtml from '../../index.html?raw'
import themeInitScript from '../../public/theme-init.js?raw'
import { applyTheme } from './applyTheme.js'
import { isThemePreference } from './ThemePreference.js'
import { THEME_STORAGE_KEY, readThemePreference, writeThemePreference } from './themeStorage.js'

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  vi.restoreAllMocks()
})

describe('applyTheme', () => {
  it('forces light and dark through data-theme', () => {
    applyTheme('dark')
    expect(document.documentElement.dataset['theme']).toBe('dark')
    applyTheme('light')
    expect(document.documentElement.dataset['theme']).toBe('light')
  })

  it('removes the attribute for system so the media query decides again', () => {
    applyTheme('dark')
    applyTheme('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})

describe('theme storage', () => {
  it('defaults to system when nothing is stored', () => {
    expect(readThemePreference()).toBe('system')
  })

  it('round-trips a choice', () => {
    writeThemePreference('dark')
    expect(readThemePreference()).toBe('dark')
  })

  it('ignores a stored value that is not a theme', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia')
    expect(readThemePreference()).toBe('system')
  })

  it('survives storage that throws, as private windows do', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readThemePreference()).toBe('system')
    expect(() => { writeThemePreference('dark') }).not.toThrow()
  })
})

describe('isThemePreference', () => {
  it('accepts the three themes and nothing else', () => {
    expect(['light', 'dark', 'system'].every(isThemePreference)).toBe(true)
    expect(isThemePreference('sepia')).toBe(false)
    expect(isThemePreference(null)).toBe(false)
  })
})

describe('theme-init.js', () => {
  it('reads the same storage key as the app, so the no-flash script cannot drift', () => {
    expect(themeInitScript).toContain(`'${THEME_STORAGE_KEY}'`)
  })

  it('is loaded from index.html as a plain script, not inline, so the CSP allows it', () => {
    expect(indexHtml).toContain('<script src="/theme-init.js"></script>')
    // Any inline <script> (one with no src) is blocked by `script-src 'self'`.
    expect(indexHtml).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/)
  })
})
