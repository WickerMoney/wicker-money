import { WIDGET_SIZES } from '../manifest/WIDGET_SIZES.js'
import { RANGE_KEYS } from '../range.js'
import type { DashboardRange } from '../range.js'
import type { WidgetSize } from '../manifest/WidgetSize.js'
import type {
  FrameHello,
  HostConnect,
  HostLocale,
  HostMessage,
  HostRefuse,
  HostSession,
  HostTheme,
  PluginApiIssue,
  PluginErrorPayload,
  PluginMessage,
} from './protocol.js'

/** Longest request path accepted, in characters. */
export const MAX_PATH_LENGTH = 2048
/** Largest content height accepted from a frame, in CSS pixels. */
export const MAX_REPORTED_HEIGHT = 100_000
/** Most theme tokens accepted in one message. */
export const MAX_THEME_TOKENS = 512
/** Longest notification text accepted, in characters. */
export const MAX_NOTIFY_LENGTH = 500

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const isStr = (v: unknown): v is string => typeof v === 'string'
const isSize = (v: unknown): v is WidgetSize => (WIDGET_SIZES as readonly unknown[]).includes(v)

/** A path the shell or API can address: starts with `/`, bounded, no control characters, not protocol-relative. */
function isPath(v: unknown): v is string {
  return (
    isStr(v) && v.length <= MAX_PATH_LENGTH && v.startsWith('/') && !v.startsWith('//') &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f\\]/.test(v)
  )
}

function parseRange(v: unknown): DashboardRange | null {
  if (!isObj(v)) return null
  const { key, label, months, from, to } = v
  if (!(RANGE_KEYS as readonly unknown[]).includes(key) || !isStr(label)) return null
  if (typeof months !== 'number' || !Number.isInteger(months) || months < 1 || months > 1200) return null
  if (!isStr(from) || !isStr(to) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null
  return { key: key as DashboardRange['key'], label, months, from, to }
}

function parseTheme(v: unknown): HostTheme | null {
  if (!isObj(v) || (v['scheme'] !== 'light' && v['scheme'] !== 'dark') || !isObj(v['tokens'])) return null
  const entries = Object.entries(v['tokens'])
  if (entries.length > MAX_THEME_TOKENS) return null
  const tokens: Record<string, string> = Object.create(null) as Record<string, string>
  for (const [name, value] of entries) {
    if (!/^--[A-Za-z0-9_-]{1,100}$/.test(name) || !isStr(value) || value.length > 512) return null
    tokens[name] = value
  }
  return { scheme: v['scheme'], tokens }
}

function parseLocale(v: unknown): HostLocale | null {
  if (!isObj(v) || !isStr(v['locale']) || !isStr(v['timezone'])) return null
  // A bad tag or zone would make every later Intl call throw, so refuse it here.
  try {
    new Intl.DateTimeFormat(v['locale'], { timeZone: v['timezone'] })
  } catch {
    return null
  }
  return { locale: v['locale'], timezone: v['timezone'] }
}

function parseSession(v: unknown): HostSession | null {
  if (!isObj(v) || !isStr(v['userId']) || !isStr(v['email']) || !isStr(v['timezone'])) return null
  return { userId: v['userId'], email: v['email'], timezone: v['timezone'] }
}

function parseError(v: unknown): PluginErrorPayload | null {
  if (!isObj(v) || !isStr(v['code']) || !isStr(v['message'])) return null
  const status = v['status']
  if (status !== undefined && (typeof status !== 'number' || !Number.isInteger(status))) return null
  let issues: PluginApiIssue[] | undefined
  if (v['issues'] !== undefined) {
    if (!Array.isArray(v['issues'])) return null
    issues = []
    for (const raw of v['issues'] as unknown[]) {
      if (!isObj(raw) || !Array.isArray(raw['path']) || !isStr(raw['message'])) return null
      const path = raw['path'] as unknown[]
      if (!path.every((p) => isStr(p) || (typeof p === 'number' && Number.isInteger(p)))) return null
      issues.push({ path: path as (string | number)[], message: raw['message'] })
    }
  }
  return {
    code: v['code'],
    message: v['message'],
    ...(status !== undefined ? { status: status as number } : {}),
    ...(issues !== undefined ? { issues } : {}),
  }
}

/**
 * Validates a message a plugin frame sent on the port.
 *
 * The host must call this on every message: the frame is untrusted, and
 * `MessagePort` delivers whatever structured-clonable value it was given.
 *
 * @param data - The `event.data` of a port message.
 * @returns The typed message, or `null` when it is malformed or of a type this
 * SDK does not know. Callers ignore `null`; an unknown type is not an error,
 * because a newer plugin may send messages an older host has not heard of.
 */
export function parsePluginMessage(data: unknown): PluginMessage | null {
  if (!isObj(data)) return null
  switch (data['type']) {
    case 'ready':
      return isId(data['protocol']) ? { type: 'ready', protocol: data['protocol'] } : null
    case 'request': {
      const { id, method, path, body, cache } = data
      if (!isId(id) || !isPath(path)) return null
      if (method !== 'GET' && method !== 'POST' && method !== 'PUT' && method !== 'DELETE') return null
      if (cache !== undefined && cache !== 'default' && cache !== 'no-store' && cache !== 'reload') return null
      if ((method === 'GET' || method === 'DELETE') && body !== undefined) return null
      return {
        type: 'request', id, method, path,
        ...(body !== undefined ? { body } : {}),
        ...(cache !== undefined ? { cache } : {}),
      }
    }
    case 'cancel':
      return isId(data['id']) ? { type: 'cancel', id: data['id'] } : null
    case 'navigate':
      return isPath(data['path']) ? { type: 'navigate', path: data['path'] } : null
    case 'resize': {
      const h = data['height']
      return typeof h === 'number' && Number.isFinite(h) && h >= 0 && h <= MAX_REPORTED_HEIGHT
        ? { type: 'resize', height: h } : null
    }
    case 'focus-out': {
      const d = data['direction']
      return d === 'next' || d === 'previous' ? { type: 'focus-out', direction: d } : null
    }
    case 'notify': {
      const { id, level, message } = data
      if (!isId(id) || !isStr(message) || message.length > MAX_NOTIFY_LENGTH) return null
      if (level !== 'info' && level !== 'success' && level !== 'warning' && level !== 'error') return null
      return { type: 'notify', id, level, message }
    }
    default:
      return null
  }
}

/**
 * Validates a message the host sent on the port.
 *
 * A plugin frame treats the host as trusted, but a wrong shape would otherwise
 * surface as an obscure error deep in a component, so the client checks too.
 *
 * @param data - The `event.data` of a port message.
 * @returns The typed message, or `null` when malformed or of an unknown type.
 */
export function parseHostMessage(data: unknown): HostMessage | null {
  if (!isObj(data)) return null
  switch (data['type']) {
    case 'init': {
      const { protocol, pluginId, kind, size, range, path } = data
      const session = parseSession(data['session'])
      const locale = parseLocale(data['locale'])
      const theme = parseTheme(data['theme'])
      if (!isId(protocol) || !isStr(pluginId) || (kind !== 'widget' && kind !== 'page')) return null
      if (session === null || locale === null || theme === null) return null
      if (size !== undefined && !isSize(size)) return null
      const parsedRange = range === undefined ? undefined : parseRange(range)
      if (parsedRange === null) return null
      if (path !== undefined && !isPath(path)) return null
      return {
        type: 'init', protocol, pluginId, kind, session, locale, theme,
        ...(size !== undefined ? { size } : {}),
        ...(parsedRange !== undefined ? { range: parsedRange } : {}),
        ...(path !== undefined ? { path } : {}),
      }
    }
    case 'response': {
      if (!isId(data['id'])) return null
      if (data['ok'] === true) return { type: 'response', id: data['id'], ok: true, value: data['value'] }
      if (data['ok'] === false) {
        const error = parseError(data['error'])
        return error === null ? null : { type: 'response', id: data['id'], ok: false, error }
      }
      return null
    }
    case 'theme': {
      const theme = parseTheme(data['theme'])
      return theme === null ? null : { type: 'theme', theme }
    }
    case 'locale': {
      const locale = parseLocale(data['locale'])
      return locale === null ? null : { type: 'locale', locale }
    }
    case 'props': {
      const { size, range } = data
      if (size !== undefined && !isSize(size)) return null
      const parsedRange = range === undefined ? undefined : parseRange(range)
      if (parsedRange === null) return null
      return {
        type: 'props',
        ...(size !== undefined ? { size } : {}),
        ...(parsedRange !== undefined ? { range: parsedRange } : {}),
      }
    }
    case 'route':
      return isPath(data['path']) ? { type: 'route', path: data['path'] } : null
    case 'focus-in': {
      const d = data['direction']
      return d === 'first' || d === 'last' ? { type: 'focus-in', direction: d } : null
    }
    default:
      return null
  }
}

/**
 * Validates the frame's opening `wm.hello` window message.
 *
 * @param data - The `event.data` of a window message from the frame.
 * @returns The hello, or `null` when it is not one.
 */
export function parseFrameHello(data: unknown): FrameHello | null {
  if (!isObj(data) || data['type'] !== 'wm.hello' || !Array.isArray(data['protocols'])) return null
  const protocols = data['protocols'] as unknown[]
  if (protocols.length === 0 || protocols.length > 16 || !protocols.every(isId)) return null
  return { type: 'wm.hello', protocols: protocols as number[] }
}

/**
 * Validates the host's reply to a hello: a connect (sent with a transferred
 * port) or a refusal.
 *
 * @param data - The `event.data` of a window message from the host.
 * @returns The connect or refuse message, or `null` when it is neither.
 */
export function parseHostReply(data: unknown): HostConnect | HostRefuse | null {
  if (!isObj(data)) return null
  if (data['type'] === 'wm.connect') return isId(data['protocol']) ? { type: 'wm.connect', protocol: data['protocol'] } : null
  if (data['type'] === 'wm.refuse') {
    const s = data['supported']
    return Array.isArray(s) && (s as unknown[]).every(isId)
      ? { type: 'wm.refuse', supported: s as number[] } : null
  }
  return null
}
