import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

const SECRET = 'a-perfectly-good-secret-that-is-long-enough-1234'
const BASE = { DATABASE_URL: 'postgresql://app:s3cure@db.internal:5432/wickermoney', AUTH_SECRET: SECRET }

function env(over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { ...BASE, ...over } as NodeJS.ProcessEnv
}

/** The message `loadConfig` throws for an environment, or a failure if it does not throw. */
function failure(over: Record<string, string | undefined>): string {
  try {
    loadConfig(env(over))
  } catch (error) {
    return (error as Error).message
  }
  throw new Error('expected loadConfig to throw')
}

describe('defaults', () => {
  it('needs only a database URL and a secret', () => {
    const config = loadConfig(env())
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      PORT: 8080,
      HOST: '0.0.0.0',
      AUTH_ACCESS_TTL_SECONDS: 900,
      AUTH_REFRESH_TTL_SECONDS: 60 * 60 * 24 * 30,
      AUTH_ISSUER: 'wickermoney',
      AUTH_AUDIENCE: 'wickermoney',
      LOG_LEVEL: 'info',
      REGISTRATION_ENABLED: true,
      TRUST_PROXY: false,
      PLUGIN_REMOTE_ORIGINS: [],
    })
    expect(config.COOKIE_SECURE).toBeUndefined()
    expect(config.BOOTSTRAP_OWNER_EMAIL).toBeUndefined()
  })

  it('reads the environment it is given, not the process', () => {
    expect(loadConfig(env({ PORT: '9090', LOG_LEVEL: 'silent' }))).toMatchObject({ PORT: 9090, LOG_LEVEL: 'silent' })
  })
})

describe('reporting problems', () => {
  it('lists every problem at once rather than stopping at the first', () => {
    const message = failure({
      DATABASE_URL: undefined,
      AUTH_SECRET: 'short',
      PORT: 'eighty',
      LOG_LEVEL: 'loud',
      AUTH_ACCESS_TTL_SECONDS: '901',
      REGISTRATION_ENABLED: 'maybe',
      TRUST_PROXY: '1',
      COOKIE_SECURE: 'yes',
      PLUGIN_REMOTE_ORIGINS: 'http://insecure.example.com',
    })
    expect(message).toMatch(/^Invalid configuration:/)
    for (const variable of [
      'DATABASE_URL', 'AUTH_SECRET', 'PORT', 'LOG_LEVEL', 'AUTH_ACCESS_TTL_SECONDS',
      'REGISTRATION_ENABLED', 'TRUST_PROXY', 'COOKIE_SECURE', 'PLUGIN_REMOTE_ORIGINS',
    ]) {
      expect(message).toContain(variable)
    }
    // One line per problem.
    expect(message.split('\n').length - 1).toBeGreaterThanOrEqual(9)
  })

  it('explains what is wrong with the secret', () => {
    expect(failure({ AUTH_SECRET: 'too-short' })).toContain('AUTH_SECRET must be at least 32 characters')
  })

  it('explains that the database URL is required when it is blank, and names it when missing', () => {
    expect(failure({ DATABASE_URL: '' })).toContain('DATABASE_URL is required')
    expect(failure({ DATABASE_URL: undefined })).toContain('DATABASE_URL')
  })
})

describe('access-token lifetime cap', () => {
  it('accepts up to 15 minutes', () => {
    expect(loadConfig(env({ AUTH_ACCESS_TTL_SECONDS: '900' })).AUTH_ACCESS_TTL_SECONDS).toBe(900)
    expect(loadConfig(env({ AUTH_ACCESS_TTL_SECONDS: '1' })).AUTH_ACCESS_TTL_SECONDS).toBe(1)
  })

  it.each(['901', '3600', '0', '-5', '12.5', 'soon'])('rejects %s', (value) => {
    expect(failure({ AUTH_ACCESS_TTL_SECONDS: value })).toContain('AUTH_ACCESS_TTL_SECONDS')
  })

  it('does not cap the refresh lifetime', () => {
    expect(loadConfig(env({ AUTH_REFRESH_TTL_SECONDS: '7776000' })).AUTH_REFRESH_TTL_SECONDS).toBe(7776000)
  })
})

describe('boolean variables', () => {
  it.each(['REGISTRATION_ENABLED', 'TRUST_PROXY'] as const)('%s accepts only the words true and false', (name) => {
    expect(loadConfig(env({ [name]: 'true' }))[name]).toBe(true)
    expect(loadConfig(env({ [name]: 'false' }))[name]).toBe(false)
    for (const bad of ['1', '0', 'yes', 'no', 'TRUE', '']) {
      expect(failure({ [name]: bad })).toContain(name)
    }
  })

  it('COOKIE_SECURE is unset by default and otherwise true or false', () => {
    expect(loadConfig(env()).COOKIE_SECURE).toBeUndefined()
    expect(String(loadConfig(env({ COOKIE_SECURE: 'true' })).COOKIE_SECURE)).toBe('true')
    expect(String(loadConfig(env({ COOKIE_SECURE: 'false' })).COOKIE_SECURE)).toBe('false')
    expect(failure({ COOKIE_SECURE: 'sometimes' })).toContain('COOKIE_SECURE')
  })

  it.each(['AUTH_RATE_LIMIT_MAX', 'AUTH_RATE_LIMIT_WINDOW_SECONDS', 'AUTH_EMAIL_RATE_LIMIT_MAX', 'AUTH_MAX_CONCURRENT_HASHES'] as const)(
    '%s must be a positive whole number',
    (name) => {
      expect(loadConfig(env({ [name]: '3' }))[name]).toBe(3)
      for (const bad of ['0', '-1', '2.5', 'many']) {
        expect(failure({ [name]: bad })).toContain(name)
      }
    },
  )
})

describe('BOOTSTRAP_OWNER_EMAIL', () => {
  it('is unset by default, and a blank value counts as unset', () => {
    expect(loadConfig(env()).BOOTSTRAP_OWNER_EMAIL).toBeUndefined()
    expect(loadConfig(env({ BOOTSTRAP_OWNER_EMAIL: '' })).BOOTSTRAP_OWNER_EMAIL).toBeUndefined()
    expect(loadConfig(env({ BOOTSTRAP_OWNER_EMAIL: '   ' })).BOOTSTRAP_OWNER_EMAIL).toBeUndefined()
  })

  it('is trimmed and lower-cased', () => {
    expect(loadConfig(env({ BOOTSTRAP_OWNER_EMAIL: '  Jeremy@Example.COM ' })).BOOTSTRAP_OWNER_EMAIL).toBe('jeremy@example.com')
  })

  it.each(['jeremy', 'jeremy@', '@example.com', 'two words@example.com', 'a@b@example.com', `${'a'.repeat(320)}@example.com`])(
    'rejects %j with a message that names the variable',
    (value) => {
      const message = failure({ BOOTSTRAP_OWNER_EMAIL: value })
      expect(message).toMatch(/^Invalid configuration:/)
      expect(message).toContain('BOOTSTRAP_OWNER_EMAIL')
    },
  )

  it('says what it expects', () => {
    expect(failure({ BOOTSTRAP_OWNER_EMAIL: 'nope' })).toContain('must be an email address')
  })

  it('is reported alongside other problems, and is valid in production', () => {
    expect(failure({ BOOTSTRAP_OWNER_EMAIL: 'nope', PORT: 'eighty' })).toMatch(/BOOTSTRAP_OWNER_EMAIL[\s\S]*PORT|PORT[\s\S]*BOOTSTRAP_OWNER_EMAIL/)
    expect(loadConfig(env({ NODE_ENV: 'production', BOOTSTRAP_OWNER_EMAIL: 'me@example.com' })).BOOTSTRAP_OWNER_EMAIL).toBe('me@example.com')
  })
})

describe('production refuses development credentials', () => {
  const production = { NODE_ENV: 'production' }

  it.each([
    ['DATABASE_URL', 'postgresql://app:wickermoney_dev_password@db:5432/wickermoney'],
    ['DATABASE_URL', 'postgresql://app:testpw@db:5432/wickermoney'],
    ['DATABASE_URL', 'postgresql://app:changeme@db:5432/wickermoney'],
    ['DATABASE_URL', 'postgresql://app:change-me@db:5432/wickermoney'],
    ['DATABASE_URL', 'postgresql://wickermoney_app:CHANGE_ME@postgres:5432/wickermoney'],
    ['DATABASE_URL', 'postgresql://app:ChangeMe@db:5432/wickermoney'],
    ['AUTH_SECRET', 'changeme-changeme-changeme-changeme-changeme'],
    ['AUTH_SECRET', 'change-me-to-a-long-random-string-before-going-live'],
    ['AUTH_SECRET', 'change_me_to_a_long_random_string_before_going_live'],
    ['AUTH_SECRET', 'a-secret-ending-in-_dev_password-and-long-enough'],
  ])('refuses %s containing a development marker (%s)', (name, value) => {
    const message = failure({ ...production, [name]: value })
    expect(message).toContain(name)
    expect(message).toContain('development credential')
    expect(message).toContain('NODE_ENV=production')
  })

  it('says how to fix each offender and where to read more, without echoing the value', () => {
    const secret = 'change-me-to-a-long-random-string-before-going-live'
    const message = failure({ ...production, AUTH_SECRET: secret })
    expect(message).toContain('openssl rand -base64 48')
    expect(message).toContain('re-run migrations')
    expect(message).toContain('wickermoney.dev/docs/self-hosting/upgrading#placeholder-credentials')
    expect(message).not.toContain(secret)
    expect(message).not.toContain('APP_DB_PASSWORD')

    const database = failure({ ...production, DATABASE_URL: 'postgresql://app:change-me@db:5432/wickermoney' })
    expect(database).toContain('APP_DB_PASSWORD')
    expect(database).not.toContain('openssl')
  })

  it('names every offender', () => {
    const message = failure({
      ...production,
      DATABASE_URL: 'postgresql://app:testpw@db/wickermoney',
      AUTH_SECRET: 'changeme-changeme-changeme-changeme-changeme',
    })
    expect(message).toContain('DATABASE_URL, AUTH_SECRET')
  })

  it('accepts real credentials in production', () => {
    expect(loadConfig(env(production)).NODE_ENV).toBe('production')
  })

  it('allows the same credentials outside production', () => {
    for (const NODE_ENV of ['development', 'test']) {
      expect(() => loadConfig(env({ NODE_ENV, DATABASE_URL: 'postgresql://app:testpw@db/wickermoney' }))).not.toThrow()
    }
  })

  it('rejects an unknown environment name', () => {
    expect(failure({ NODE_ENV: 'staging' })).toContain('NODE_ENV')
  })
})

describe('PLUGIN_REMOTE_ORIGINS', () => {
  it('is empty by default, which means same-origin only', () => {
    expect(loadConfig(env()).PLUGIN_REMOTE_ORIGINS).toEqual([])
    expect(loadConfig(env({ PLUGIN_REMOTE_ORIGINS: '' })).PLUGIN_REMOTE_ORIGINS).toEqual([])
    expect(loadConfig(env({ PLUGIN_REMOTE_ORIGINS: ' , ' })).PLUGIN_REMOTE_ORIGINS).toEqual([])
  })

  it('parses a comma-separated list of https origins', () => {
    const config = loadConfig(env({
      PLUGIN_REMOTE_ORIGINS: 'https://plugins.example.com, https://cdn.example.org:8443/',
    }))
    expect(config.PLUGIN_REMOTE_ORIGINS).toEqual(['https://plugins.example.com', 'https://cdn.example.org:8443'])
  })

  it.each([
    'http://plugins.example.com',
    'plugins.example.com',
    'https://plugins.example.com/some/path',
    'https://user:pw@plugins.example.com',
    '*',
    'javascript:alert(1)',
  ])('rejects %s', (value) => {
    expect(failure({ PLUGIN_REMOTE_ORIGINS: value })).toContain('PLUGIN_REMOTE_ORIGINS')
  })

  it('reports each bad entry of a list', () => {
    const message = failure({ PLUGIN_REMOTE_ORIGINS: 'https://ok.example.com,http://a.example.com,nonsense' })
    expect(message).toContain("'http://a.example.com'")
    expect(message).toContain("'nonsense'")
    expect(message).not.toContain("'https://ok.example.com'")
  })
})

describe('WEB_DIST_DIR', () => {
  it('is unset by default, so development keeps serving the UI from Vite', () => {
    expect(loadConfig(env()).WEB_DIST_DIR).toBeUndefined()
  })

  it('takes the directory the image puts the built web app in', () => {
    expect(loadConfig(env({ WEB_DIST_DIR: '/app/web' })).WEB_DIST_DIR).toBe('/app/web')
  })

  it.each(['', '   '])('treats %j as unset rather than serving the working directory', (value) => {
    expect(loadConfig(env({ WEB_DIST_DIR: value })).WEB_DIST_DIR).toBeUndefined()
  })

  it('trims surrounding whitespace', () => {
    expect(loadConfig(env({ WEB_DIST_DIR: '  /app/web  ' })).WEB_DIST_DIR).toBe('/app/web')
  })
})
