import { z } from 'zod'

/** A same-origin path to a plugin's built assets: `/plugins/<folder>/...`, no traversal, no encoding tricks. */
const SAME_ORIGIN_PATH = /^\/plugins\/[A-Za-z0-9][A-Za-z0-9_-]*\/[A-Za-z0-9._/-]*$/

/**
 * Validates the *shape* of a plugin's `remoteEntry`.
 *
 * Two forms are accepted:
 *
 *  - a same-origin path under `/plugins/<folder>/`, served by the host itself;
 *  - an `https:` URL without embedded credentials.
 *
 * Everything else is refused: `http:`, `data:`, `javascript:`, protocol-relative
 * (`//host/x`) and backslash forms, and any path containing `..`, `//` or
 * percent-encoding. Whether an `https:` origin is *trusted* is deployment
 * policy, not manifest shape, so it is decided by the host with
 * `checkRemoteEntry` against its configured allowlist.
 */
export const remoteEntrySchema = z.string().min(1).superRefine((value, ctx) => {
  if (value.startsWith('/')) {
    const clean = SAME_ORIGIN_PATH.test(value) && !value.includes('..') && !value.includes('//')
    if (!clean) {
      ctx.addIssue({
        code: 'custom',
        message: 'A relative remoteEntry must be a plain path under /plugins/<folder>/.',
      })
    }
    return
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    ctx.addIssue({ code: 'custom', message: 'remoteEntry must be a /plugins/... path or an https URL.' })
    return
  }
  if (url.protocol !== 'https:') {
    ctx.addIssue({ code: 'custom', message: 'A remote remoteEntry must use https.' })
  } else if (url.username !== '' || url.password !== '') {
    ctx.addIssue({ code: 'custom', message: 'remoteEntry must not embed credentials.' })
  } else if (value.includes('\\')) {
    ctx.addIssue({ code: 'custom', message: 'remoteEntry must not contain backslashes.' })
  }
})
