/**
 * Makes a random version-4 UUID in the browser.
 *
 * `crypto.randomUUID` exists only in secure contexts (HTTPS or `localhost`), so
 * a self-hosted instance reached as `http://192.168.x.x:8080` has no such
 * function and a direct call throws `crypto.randomUUID is not a function`.
 * `crypto.getRandomValues` has no such restriction, so the fallback formats its
 * output as a UUID with the version and variant bits set.
 *
 * Call this rather than `crypto.randomUUID()` anywhere in browser code; an
 * ESLint rule enforces it.
 *
 * @returns A lower-case UUID string such as `3b241101-e2bb-4255-8caf-4136c566a962`.
 * @example
 * const key = newUuid()
 */
export function newUuid(): string {
  // eslint-disable-next-line no-restricted-properties -- the one sanctioned call site
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const hex = Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
