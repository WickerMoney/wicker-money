import { describe, expect, it } from 'vitest'
import { buildFrameContentSecurityPolicy } from './buildFrameContentSecurityPolicy.js'

const directives = (policy: string) => policy.split('; ')

describe('buildFrameContentSecurityPolicy', () => {
  it('sandboxes the document with scripts and nothing else', () => {
    const d = directives(buildFrameContentSecurityPolicy('https://money.example.com'))
    expect(d[0]).toBe('sandbox allow-scripts')
    const sandbox = d.find((x) => x.startsWith('sandbox'))
    expect(sandbox).not.toContain('allow-same-origin')
    expect(sandbox).not.toContain('allow-top-navigation')
    expect(sandbox).not.toContain('allow-popups')
    expect(sandbox).not.toContain('allow-forms')
  })

  it('denies everything it does not list, including the network', () => {
    const d = directives(buildFrameContentSecurityPolicy('https://money.example.com'))
    expect(d).toContain("default-src 'none'")
    expect(d).toContain("connect-src 'none'")
    expect(d).toContain("base-uri 'none'")
    expect(d).toContain("form-action 'none'")
    // No frame-src or img-src: both fall back to default-src 'none'.
    expect(d.some((x) => x.startsWith('frame-src'))).toBe(false)
    expect(d.some((x) => x.startsWith('img-src'))).toBe(false)
  })

  it("lists 'self' and the request origin, because WebKit does not match 'self' in an opaque origin", () => {
    expect(buildFrameContentSecurityPolicy('https://money.example.com')).toContain(
      "script-src 'self' https://money.example.com;",
    )
    expect(buildFrameContentSecurityPolicy('http://192.168.1.20:8080')).toContain(
      "script-src 'self' http://192.168.1.20:8080;",
    )
    expect(buildFrameContentSecurityPolicy('http://[::1]:8080')).toContain("script-src 'self' http://[::1]:8080;")
  })

  it('lets stylesheets come from the same places as scripts, and inline style', () => {
    const d = directives(buildFrameContentSecurityPolicy('https://money.example.com', ['https://plugins.example.com']))
    expect(d).toContain("style-src 'unsafe-inline' 'self' https://money.example.com https://plugins.example.com")
  })

  it('adds the operator plugin origins after it', () => {
    expect(buildFrameContentSecurityPolicy('https://money.example.com', ['https://plugins.example.com'])).toContain(
      "script-src 'self' https://money.example.com https://plugins.example.com;",
    )
  })

  it('keeps only the frame to our own pages as an ancestor', () => {
    expect(directives(buildFrameContentSecurityPolicy(undefined))).toContain("frame-ancestors 'self'")
  })

  it.each([
    ['nothing', undefined],
    ['a path', 'https://money.example.com/x'],
    ['a directive break', "https://money.example.com; script-src *"],
    ['a space', 'https://money.example.com *'],
    ['another scheme', 'javascript://x'],
    ['an empty host', 'https://'],
    ['a quote', "https://a'b"],
  ])('falls back to self alone for %s', (_name, origin) => {
    const policy = buildFrameContentSecurityPolicy(origin)
    expect(policy).toContain("script-src 'self';")
    expect(policy).not.toContain('*')
  })

  it.each(['http://plugins.example.com', 'https://a.example.com/path', "https://a.example.com; default-src *"])(
    'refuses the plugin origin %s',
    (origin) => {
      expect(() => buildFrameContentSecurityPolicy('https://money.example.com', [origin])).toThrow(/cannot go in a Content-Security-Policy/)
    },
  )
})
