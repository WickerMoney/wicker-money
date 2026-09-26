import { describe, expect, it } from 'vitest'
import { buildContentSecurityPolicy } from './buildContentSecurityPolicy.js'

function directive(policy: string, name: string): string | undefined {
  return policy.split('; ').find((part) => part.startsWith(`${name} `))
}

describe('buildContentSecurityPolicy', () => {
  it('limits scripts and connections to this origin by default', () => {
    const policy = buildContentSecurityPolicy()
    expect(directive(policy, 'script-src')).toBe("script-src 'self'")
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self'")
  })

  it('never upgrades requests, so a plain-HTTP install still loads', () => {
    expect(buildContentSecurityPolicy()).not.toContain('upgrade-insecure-requests')
  })

  it('locks down framing, plugins, base URI and form targets', () => {
    const policy = buildContentSecurityPolicy()
    expect(directive(policy, 'frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(directive(policy, 'object-src')).toBe("object-src 'none'")
    expect(directive(policy, 'base-uri')).toBe("base-uri 'self'")
    expect(directive(policy, 'form-action')).toBe("form-action 'self'")
  })

  it('allows the configured plugin origins for scripts and connections only', () => {
    const policy = buildContentSecurityPolicy(['https://plugins.example.com', 'https://cdn.example.org:8443'])
    expect(directive(policy, 'script-src')).toBe("script-src 'self' https://plugins.example.com https://cdn.example.org:8443")
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self' https://plugins.example.com https://cdn.example.org:8443")
    expect(directive(policy, 'style-src')).toBe("style-src 'self' 'unsafe-inline'")
    expect(directive(policy, 'default-src')).toBe("default-src 'self'")
  })

  it.each([
    ['a directive smuggled after the origin', "https://a.example.com; script-src *"],
    ['plain http', 'http://plugins.example.com'],
    ['a path', 'https://plugins.example.com/remotes'],
    ['a wildcard scheme source', '*'],
    ['whitespace', 'https://a.example.com https://b.example.com'],
    ['an empty string', ''],
  ])('refuses %s', (_label, origin) => {
    expect(() => buildContentSecurityPolicy([origin])).toThrow(/cannot go in a Content-Security-Policy/)
  })
})
