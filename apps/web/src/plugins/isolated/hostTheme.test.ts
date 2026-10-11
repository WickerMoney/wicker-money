import { afterEach, describe, expect, it } from 'vitest'
import { readHostLocale, readHostTheme } from './hostTheme.js'

afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('style')
  document.head.innerHTML = ''
})

describe('readHostTheme', () => {
  it('reads the scheme from data-theme', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    expect(readHostTheme().scheme).toBe('dark')
    document.documentElement.setAttribute('data-theme', 'light')
    expect(readHostTheme().scheme).toBe('light')
  })

  // Nested @media blocks are not evaluated by jsdom, so dark-mode token blocks are checked in the browser check.
  it('collects only --wm- tokens, from stylesheets and inline style', () => {
    const style = document.createElement('style')
    style.textContent = ':root { --wm-accent: #112233; --other: red; }'
    document.head.append(style)
    document.documentElement.style.setProperty('--wm-inline', '4px')
    const { tokens } = readHostTheme()
    expect(Object.keys(tokens).sort()).toEqual(['--wm-accent', '--wm-inline'])
    expect(tokens['--wm-accent']).toBe('#112233')
    expect(tokens['--wm-inline']).toBe('4px')
  })

  it('leaves out a value that is too long for the SDK to accept', () => {
    document.documentElement.style.setProperty('--wm-big', 'x'.repeat(600))
    document.documentElement.style.setProperty('--wm-ok', '1')
    expect(Object.keys(readHostTheme().tokens)).toEqual(['--wm-ok'])
  })
})

describe('readHostLocale', () => {
  it('uses the browser language and the given zone', () => {
    expect(readHostLocale('Europe/Paris')).toEqual({ locale: navigator.language || 'en-US', timezone: 'Europe/Paris' })
  })
})
