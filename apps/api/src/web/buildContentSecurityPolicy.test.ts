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

  it('does not take a plugin origin: remote plugin code runs only in the frame, so the page never needs one', () => {
    // Every other part of the policy is unchanged whoever is allowlisted for the frame.
    const policy = buildContentSecurityPolicy()
    expect(policy).not.toMatch(/https?:/)
    expect(directive(policy, 'style-src')).toBe("style-src 'self' 'unsafe-inline'")
    expect(directive(policy, 'default-src')).toBe("default-src 'self'")
    expect(buildContentSecurityPolicy.length).toBe(0)
  })
})
