import { z } from 'zod'

/**
 * Schema for all configuration, which is environment-derived. A missing or
 * malformed value fails startup loudly rather than surfacing as a confusing
 * runtime error later.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /** Signing key for access tokens (at least 32 characters). Generate with: openssl rand -base64 48 */
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  /**
   * Access-token lifetime. Capped at 15 minutes as defence in depth: every
   * request also checks that the token's session is still live, but a shorter
   * lifetime bounds the damage if that check were ever bypassed.
   */
  AUTH_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().max(900).default(900),
  AUTH_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
  AUTH_ISSUER: z.string().default('wickermoney'),
  AUTH_AUDIENCE: z.string().default('wickermoney'),

  /** Whether `POST /auth/register` is open. Set to `false` once the accounts you need exist. */
  REGISTRATION_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /**
   * The email address whose account becomes the instance owner. Compared
   * without regard to case and surrounding spaces; a blank value counts as
   * unset. When unset, the first account registered becomes the owner.
   *
   * Registration does not verify email addresses, so this does not stop
   * someone who knows the address from registering it first. It stops the
   * ordinary case, a stranger reaching a fresh instance before its operator.
   */
  BOOTSTRAP_OWNER_EMAIL: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim().toLowerCase()))
    .pipe(z.string().max(320).email('BOOTSTRAP_OWNER_EMAIL must be an email address such as you@example.com').optional()),

  /**
   * Trust `X-Forwarded-*` headers from a reverse proxy. Required for per-client
   * rate limiting to see the real client address; leave `false` when the API is
   * exposed directly, or clients could spoof their address.
   */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /** Requests allowed per client and per window on unauthenticated auth endpoints. */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  /** Length of the auth rate-limit window, in seconds. */
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  /**
   * Login and registration attempts allowed per email address and window.
   * Stricter than the per-client limit because it bounds password guessing
   * against one account even when the guesses come from many addresses.
   */
  AUTH_EMAIL_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  /**
   * Password hashes computed at once. Each Argon2id hash holds tens of MiB, so
   * an unbounded burst of logins could exhaust memory; excess work queues.
   */
  AUTH_MAX_CONCURRENT_HASHES: z.coerce.number().int().positive().default(4),

  /**
   * Whether the refresh cookie carries the `Secure` attribute. Defaults to
   * `true` in production. Set to `false` only for plain-HTTP local use.
   */
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),

  /**
   * Comma-separated `https` origins (for example `https://plugins.example.com`)
   * that may serve plugin front-end code. Empty by default, which means plugin
   * code is loaded from this host only.
   */
  PLUGIN_REMOTE_ORIGINS: z
    .string()
    .default('')
    .transform((value, ctx) => {
      const origins: string[] = []
      for (const raw of value.split(',').map((s) => s.trim()).filter((s) => s !== '')) {
        let origin: string | undefined
        try {
          const url = new URL(raw)
          if (url.protocol === 'https:' && url.origin === raw.replace(/\/$/, '')) origin = url.origin
        } catch {
          // fall through to the issue below
        }
        if (origin === undefined) {
          ctx.addIssue({ code: 'custom', message: `'${raw}' is not an https origin such as https://plugins.example.com` })
        } else {
          origins.push(origin)
        }
      }
      return origins
    }),

  /**
   * Directory holding the built web app (`apps/web/dist`). When set, the API
   * serves the UI and the plugin remotes itself, on the same origin as `/api`.
   * Unset in development, where Vite serves the UI and proxies `/api` here; the
   * container image sets it. A blank value counts as unset.
   */
  WEB_DIST_DIR: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim())),

  /**
   * Server log level, or `silent` to disable logging entirely.
   *
   * This is not cosmetic. The error handler returns a deliberately opaque
   * `internal_error` to the client and keeps the real cause in the log — so
   * with logging off, an unexpected failure leaves *no* record anywhere and
   * "Something went wrong." is genuinely all anyone gets.
   */
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
})

/** Validated application configuration, with defaults applied. */
export type Config = z.infer<typeof schema>

/** Where the start-up error sends someone whose credentials were refused. */
const PLACEHOLDER_CREDENTIALS_DOCS = 'https://wickermoney.dev/docs/self-hosting/upgrading#placeholder-credentials'

/**
 * Lowercase substrings that identify the throwaway credentials shipped for
 * local development, and the placeholders (`change-me`, and the quickstart's
 * `CHANGE_ME`) an operator is meant to replace before going live. Matched
 * without regard to case.
 */
const DEV_CREDENTIAL_MARKERS = ['_dev_password', 'testpw', 'changeme', 'change-me', 'change_me']

/**
 * Parses and validates configuration from environment variables.
 *
 * @param env - Environment to read; defaults to `process.env`.
 * @returns The typed configuration with defaults applied (`PORT` 8080, `HOST` `0.0.0.0`, access-token TTL 900 s, refresh TTL 30 days, `LOG_LEVEL` `info`).
 * @throws {Error} Listing every invalid or missing variable, if validation fails.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid configuration:\n${detail}`)
  }
  if (parsed.data.NODE_ENV === 'production') {
    const offenders = [
      ['DATABASE_URL', parsed.data.DATABASE_URL],
      ['AUTH_SECRET', parsed.data.AUTH_SECRET],
    ].filter(([, value]) => DEV_CREDENTIAL_MARKERS.some((m) => (value ?? '').toLowerCase().includes(m)))
    if (offenders.length > 0) {
      const names = offenders.map(([k]) => k)
      const howToFix = [
        names.includes('AUTH_SECRET')
          ? '  AUTH_SECRET: generate one with `openssl rand -base64 48`, then re-run migrations.'
          : null,
        names.includes('DATABASE_URL')
          ? '  DATABASE_URL: set a new APP_DB_PASSWORD (and the same password in DATABASE_URL), then re-run migrations.'
          : null,
      ].filter((line) => line !== null)
      throw new Error(
        `Invalid configuration:\n  ${names.join(', ')} contain a development ` +
          `credential. Refusing to start with NODE_ENV=production.\n\n` +
          `Placeholder values are publicly known or easy to guess, so anyone could forge a sign-in or reach the database. ` +
          `Replace them with real secrets:\n${howToFix.join('\n')}\n` +
          `Steps and what to expect: ${PLACEHOLDER_CREDENTIALS_DOCS}`,
      )
    }
  }
  return parsed.data
}
