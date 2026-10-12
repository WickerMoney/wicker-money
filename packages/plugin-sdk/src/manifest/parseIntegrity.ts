import { integritySchema } from './integritySchema.js'

/**
 * Validates an untrusted `integrity` value with the same rules the manifest
 * uses, for code that receives a pin outside a manifest (the sandboxed frame
 * reads it from its URL).
 *
 * @param value - The value to check, already decoded from JSON.
 * @returns The pin, or a message saying what is wrong with it.
 */
export function parseIntegrity(value: unknown): { readonly integrity: Readonly<Record<string, string>> } | { readonly error: string } {
  const result = integritySchema.safeParse(value)
  if (!result.success) return { error: result.error.issues[0]?.message ?? 'The integrity pin is not valid.' }
  return { integrity: result.data }
}
