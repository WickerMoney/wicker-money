import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import type { Db } from './db/client.js'
import { AppError } from './errors.js'

/** Collects everything the server logs so it can be asserted on. */
function captureLog() {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk))
      callback()
    },
  })
  return { lines, stream }
}

function appWithFailingRoute(error: Error, stream: NodeJS.WritableStream) {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://unused@localhost:5432/unused',
    AUTH_SECRET: 'test-secret-that-is-comfortably-long-enough-32',
    LOG_LEVEL: 'error',
  } as NodeJS.ProcessEnv)

  // No query ever runs — the route throws before touching the database — so a
  // stub keeps this a fast unit test rather than an integration one.
  const app = buildApp({ db: {} as Db, config, logStream: stream })
  app.get('/__throws', () => {
    throw error
  })
  return app
}

describe('the unhandled-error path', () => {
  it('keeps the real cause in the log while the client gets a generic message', async () => {
    const { lines, stream } = captureLog()
    const app = appWithFailingRoute(new Error('permission denied for schema core'), stream)

    const res = await app.inject({ method: 'GET', url: '/__throws' })

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ code: 'internal_error', message: 'Something went wrong.' })

    // The point of the whole handler. `logger: false` makes `request.log.error`
    // a silent no-op, which turns every 500 into an unexplained one — this is
    // the assertion that catches that regression.
    const logged = lines.join('')
    expect(logged).toContain('permission denied for schema core')
    expect(logged).toContain('/__throws')

    await app.close()
  })

  it('records the PostgreSQL diagnostics pino would otherwise drop', async () => {
    const { lines, stream } = captureLog()
    const pgError = Object.assign(new Error('permission denied for function register_user'), {
      code: '42501',
      detail: 'Role wickermoney_app lacks EXECUTE.',
      hint: 'GRANT EXECUTE ON FUNCTION core.register_user TO wickermoney_app;',
    })
    const app = appWithFailingRoute(pgError, stream)

    await app.inject({ method: 'GET', url: '/__throws' })

    const logged = lines.join('')
    expect(logged).toContain('42501')
    expect(logged).toContain('lacks EXECUTE')
    expect(logged).toContain('GRANT EXECUTE ON FUNCTION')

    await app.close()
  })

  it('passes an AppError through untouched — it is already client-safe', async () => {
    const { lines, stream } = captureLog()
    const app = appWithFailingRoute(new AppError('That email is taken.', 409, 'email_taken'), stream)

    const res = await app.inject({ method: 'GET', url: '/__throws' })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ code: 'email_taken', message: 'That email is taken.' })
    expect(lines.join('')).not.toContain('unhandled error')

    await app.close()
  })
})
