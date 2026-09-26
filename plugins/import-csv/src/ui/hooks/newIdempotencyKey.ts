/**
 * Makes a random key that names one commit intent.
 *
 * Uses `crypto.randomUUID`, which browsers expose only in secure contexts, and
 * falls back to formatting `crypto.getRandomValues` output as a version-4 UUID
 * for a page served over plain HTTP.
 *
 * @returns A UUID string.
 */
export function newIdempotencyKey(): string {
  // eslint-disable-next-line no-restricted-properties -- guarded, with a fallback below
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const hex = Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
