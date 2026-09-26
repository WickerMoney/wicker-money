import { hash, verify } from '@node-rs/argon2'

/**
 * Argon2id parameters.
 *
 * OWASP's current floor is 19 MiB / t=2 / p=1; we sit above it on memory,
 * which is the parameter that actually costs an attacker with GPUs.
 */
const OPTIONS = {
  memoryCost: 47_104, // 46 MiB
  timeCost: 3,
  parallelism: 1,
} as const

/**
 * Hashes a password with Argon2id.
 *
 * @param plaintext - The password to hash.
 * @returns A self-describing PHC-format digest (parameters and random salt included).
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, OPTIONS)
}

/**
 * Verifies a password against a stored digest.
 *
 * Never throws on a malformed or mismatched hash — it returns false. A throw
 * here would let a caller distinguish "no such user" from "wrong password"
 * through error handling rather than timing.
 *
 * @param digest - Stored Argon2 digest.
 * @param plaintext - Candidate password.
 * @returns True only if the digest is valid and matches.
 */
export async function verifyPassword(digest: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(digest, plaintext)
  } catch {
    return false
  }
}
