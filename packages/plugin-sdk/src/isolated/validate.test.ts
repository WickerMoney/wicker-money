import { describe, expect, it } from 'vitest'
import {
  MAX_MODAL_LAYOUT, MAX_PATH_LENGTH, MAX_REPORTED_HEIGHT, parseFrameHello, parseHostMessage, parseHostReply, parsePluginMessage,
} from './validate.js'

const theme = { scheme: 'dark', tokens: { '--surface': '#111' } }
const locale = { locale: 'en-GB', timezone: 'Europe/London' }
const session = { userId: 'u1', email: 'a@b.test', timezone: 'Europe/London' }
const init = { type: 'init', protocol: 1, pluginId: 'wickermoney.insights', kind: 'widget', session, locale, theme }

describe('parsePluginMessage (frame to host)', () => {
  it('accepts each well-formed message', () => {
    expect(parsePluginMessage({ type: 'ready', protocol: 1 })).toEqual({ type: 'ready', protocol: 1 })
    expect(parsePluginMessage({ type: 'request', id: 1, method: 'GET', path: '/core/transactions?x=1', cache: 'no-store' }))
      .toEqual({ type: 'request', id: 1, method: 'GET', path: '/core/transactions?x=1', cache: 'no-store' })
    expect(parsePluginMessage({ type: 'request', id: 2, method: 'POST', path: '/p/x/y', body: { a: 1 } }))
      .toEqual({ type: 'request', id: 2, method: 'POST', path: '/p/x/y', body: { a: 1 } })
    expect(parsePluginMessage({ type: 'cancel', id: 2 })).toEqual({ type: 'cancel', id: 2 })
    expect(parsePluginMessage({ type: 'navigate', path: '/transactions' })).toEqual({ type: 'navigate', path: '/transactions' })
    expect(parsePluginMessage({ type: 'resize', height: 240 })).toEqual({ type: 'resize', height: 240 })
    expect(parsePluginMessage({ type: 'focus-out', direction: 'next' })).toEqual({ type: 'focus-out', direction: 'next' })
    expect(parsePluginMessage({ type: 'notify', id: 3, level: 'info', message: 'hi' }))
      .toEqual({ type: 'notify', id: 3, level: 'info', message: 'hi' })
    expect(parsePluginMessage({ type: 'modal', open: true })).toEqual({ type: 'modal', open: true })
    expect(parsePluginMessage({ type: 'modal', open: false, extra: 1 })).toEqual({ type: 'modal', open: false })
  })

  it('drops unknown fields rather than passing them on', () => {
    const msg = parsePluginMessage({ type: 'request', id: 1, method: 'GET', path: '/a', headers: { authorization: 'x' } })
    expect(msg).toEqual({ type: 'request', id: 1, method: 'GET', path: '/a' })
  })

  it.each([
    ['not an object', 'ready'],
    ['an array', []],
    ['null', null],
    ['an unknown type', { type: 'dialog', title: 'x' }],
    ['a method outside the four', { type: 'request', id: 1, method: 'PATCH', path: '/a' }],
    ['a lower-case method', { type: 'request', id: 1, method: 'get', path: '/a' }],
    ['a body on GET', { type: 'request', id: 1, method: 'GET', path: '/a', body: {} }],
    ['a body on DELETE', { type: 'request', id: 1, method: 'DELETE', path: '/a', body: {} }],
    ['an absolute URL', { type: 'request', id: 1, method: 'GET', path: 'https://evil.test/a' }],
    ['a protocol-relative path', { type: 'request', id: 1, method: 'GET', path: '//evil.test/a' }],
    ['a backslash', { type: 'request', id: 1, method: 'GET', path: '/a\\b' }],
    ['a control character', { type: 'request', id: 1, method: 'GET', path: '/a\nb' }],
    ['a path over the limit', { type: 'request', id: 1, method: 'GET', path: `/${'a'.repeat(MAX_PATH_LENGTH)}` }],
    ['a negative id', { type: 'request', id: -1, method: 'GET', path: '/a' }],
    ['a fractional id', { type: 'request', id: 1.5, method: 'GET', path: '/a' }],
    ['a string id', { type: 'request', id: '1', method: 'GET', path: '/a' }],
    ['an unknown cache mode', { type: 'request', id: 1, method: 'GET', path: '/a', cache: 'force-cache' }],
    ['NaN height', { type: 'resize', height: NaN }],
    ['negative height', { type: 'resize', height: -1 }],
    ['absurd height', { type: 'resize', height: MAX_REPORTED_HEIGHT + 1 }],
    ['a bad direction', { type: 'focus-out', direction: 'up' }],
    ['a bad notify level', { type: 'notify', id: 1, level: 'fatal', message: 'x' }],
    ['an over-long notify', { type: 'notify', id: 1, level: 'info', message: 'x'.repeat(501) }],
    ['a modal with no state', { type: 'modal' }],
    ['a modal whose state is not a boolean', { type: 'modal', open: 'yes' }],
  ])('rejects %s', (_name, data) => {
    expect(parsePluginMessage(data)).toBeNull()
  })
})

describe('parseHostMessage (host to frame)', () => {
  it('accepts init with optional widget and page fields', () => {
    expect(parseHostMessage(init)).toMatchObject({ type: 'init', kind: 'widget', pluginId: 'wickermoney.insights' })
    const range = { key: '12m', label: '12 months', months: 12, from: '2025-11-01', to: '2026-11-01' }
    expect(parseHostMessage({ ...init, size: 'md', range })).toMatchObject({ size: 'md', range })
    expect(parseHostMessage({ ...init, kind: 'page', path: '/overview' })).toMatchObject({ kind: 'page', path: '/overview' })
  })

  it('accepts ok and error responses, with issues', () => {
    expect(parseHostMessage({ type: 'response', id: 1, ok: true, value: { a: 1 } })).toEqual({ type: 'response', id: 1, ok: true, value: { a: 1 } })
    const error = { code: 'validation_failed', message: 'Bad', status: 400, issues: [{ path: ['name', 0], message: 'Required' }] }
    expect(parseHostMessage({ type: 'response', id: 1, ok: false, error })).toEqual({ type: 'response', id: 1, ok: false, error })
  })

  it('accepts theme, locale, props, route and focus-in', () => {
    expect(parseHostMessage({ type: 'theme', theme })).toMatchObject({ type: 'theme' })
    expect(parseHostMessage({ type: 'locale', locale })).toMatchObject({ type: 'locale' })
    expect(parseHostMessage({ type: 'props', size: 'lg' })).toEqual({ type: 'props', size: 'lg' })
    expect(parseHostMessage({ type: 'route', path: '/a/b' })).toEqual({ type: 'route', path: '/a/b' })
    expect(parseHostMessage({ type: 'focus-in', direction: 'last' })).toEqual({ type: 'focus-in', direction: 'last' })
  })

  it('accepts modal-layout, lifted or not', () => {
    expect(parseHostMessage({ type: 'modal-layout', lifted: true, x: 18, y: -504.5, width: 1036 }))
      .toEqual({ type: 'modal-layout', lifted: true, x: 18, y: -504.5, width: 1036 })
    expect(parseHostMessage({ type: 'modal-layout', lifted: false, x: 0, y: 0, width: 0 }))
      .toEqual({ type: 'modal-layout', lifted: false, x: 0, y: 0, width: 0 })
  })

  it.each([
    ['an unknown type', { type: 'confetti' }],
    ['init with a bad kind', { ...init, kind: 'popup' }],
    ['init with a bad size', { ...init, size: 'xl' }],
    ['init with a bad locale tag', { ...init, locale: { locale: 'not a tag!!', timezone: 'Europe/London' } }],
    ['init with a bad time zone', { ...init, locale: { locale: 'en-GB', timezone: 'Mars/Olympus' } }],
    ['init with a token not starting --', { ...init, theme: { scheme: 'dark', tokens: { color: 'red' } } }],
    ['init with a bad scheme', { ...init, theme: { scheme: 'sepia', tokens: {} } }],
    ['modal-layout with no lifted flag', { type: 'modal-layout', x: 0, y: 0, width: 10 }],
    ['modal-layout with a string offset', { type: 'modal-layout', lifted: true, x: '1', y: 0, width: 10 }],
    ['modal-layout with a negative width', { type: 'modal-layout', lifted: true, x: 0, y: 0, width: -1 }],
    ['modal-layout with an absurd offset', { type: 'modal-layout', lifted: true, x: MAX_MODAL_LAYOUT + 1, y: 0, width: 10 }],
    ['modal-layout with NaN', { type: 'modal-layout', lifted: true, x: NaN, y: 0, width: 10 }],
    ['a response with neither ok nor error', { type: 'response', id: 1 }],
    ['an error response with no message', { type: 'response', id: 1, ok: false, error: { code: 'x' } }],
    ['a range with a bad date', { type: 'props', range: { key: '12m', label: 'x', months: 12, from: 'yesterday', to: '2026-01-01' } }],
  ])('rejects %s', (_name, data) => {
    expect(parseHostMessage(data)).toBeNull()
  })

  it('refuses a theme with too many tokens', () => {
    const tokens = Object.fromEntries(Array.from({ length: 513 }, (_, i) => [`--t${i}`, 'x']))
    expect(parseHostMessage({ type: 'theme', theme: { scheme: 'light', tokens } })).toBeNull()
  })
})

describe('window handshake messages', () => {
  it('parses hello', () => {
    expect(parseFrameHello({ type: 'wm.hello', protocols: [1] })).toEqual({ type: 'wm.hello', protocols: [1] })
    expect(parseFrameHello({ type: 'wm.hello', protocols: [] })).toBeNull()
    expect(parseFrameHello({ type: 'wm.hello', protocols: ['1'] })).toBeNull()
    expect(parseFrameHello({ type: 'hello' })).toBeNull()
  })

  it('parses connect and refuse', () => {
    expect(parseHostReply({ type: 'wm.connect', protocol: 1 })).toEqual({ type: 'wm.connect', protocol: 1 })
    expect(parseHostReply({ type: 'wm.refuse', supported: [2] })).toEqual({ type: 'wm.refuse', supported: [2] })
    expect(parseHostReply({ type: 'wm.connect' })).toBeNull()
    expect(parseHostReply({ type: 'other' })).toBeNull()
  })
})
