import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { loadConfig } from '../config.js'
import { KyselyUnitOfWork } from '../data/KyselyUnitOfWork.js'
import { configureTenantContext } from '../db/configureTenantContext.js'
import { createDb } from '../db/client.js'
import { AuthService } from './service.js'

/**
 * Command-line entry point that resets a user's password from the server.
 *
 * A self-hosted instance has no mail server, so there is no "forgot password"
 * link to send and no support desk behind it. Without this, a forgotten
 * password means the account is gone and the ledger with it — which is a
 * ridiculous way to lose a year of financial history.
 *
 * Whoever can run this already has the database credentials, so it
 * grants no access they did not already have. It is a convenience for the
 * operator, not a bypass: the same person could always have written the UPDATE
 * by hand. What they could not easily do is produce a correct Argon2id digest
 * with the application's own parameters, which is the part that actually
 * matters and the part people get wrong.
 *
 *   pnpm --filter @wickermoney/api reset-password you@example.com
 *
 * The password is read from stdin rather than taken as an argument: an argument
 * lands in shell history and in the process list, where anyone on the machine
 * can read it. With `--generate`, a strong one is generated and printed once.
 * Existing sessions for the account are revoked. Exits non-zero on failure.
 */
const config = loadConfig()
configureTenantContext(config.AUTH_SECRET)
const db = createDb(config.DATABASE_URL)
const auth = new AuthService(new KyselyUnitOfWork(db), config)

/** Prints usage to stderr and exits with status 2. */
function usage(): never {
  console.error(
    'Usage: pnpm --filter @wickermoney/api reset-password <email> [--generate]\n\n' +
      '  <email>       the account to reset\n' +
      '  --generate    print a new random password instead of prompting\n',
  )
  process.exit(2)
}

/**
 * Generates a passphrase-shaped password.
 *
 * Base64url of 18 random bytes: 144 bits, no ambiguous characters to
 * transcribe, and short enough to retype once before pasting it somewhere safe.
 *
 * @returns A random 24-character base64url string.
 */
function generatePassword(): string {
  return randomBytes(18).toString('base64url')
}

/**
 * Prompts twice for a new password (on stderr, reading stdin).
 *
 * Exits the process with status 1 if it is shorter than 12 characters or the
 * two entries differ.
 *
 * @returns The confirmed password.
 */
async function readPassword(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    const first = await rl.question('New password (at least 12 characters): ')
    if (first.length < 12) {
      console.error('\nThat is shorter than 12 characters. Nothing changed.')
      process.exit(1)
    }
    const again = await rl.question('Again: ')
    if (first !== again) {
      console.error('\nThose do not match. Nothing changed.')
      process.exit(1)
    }
    return first
  } finally {
    rl.close()
  }
}

const email = process.argv[2]
if (email === undefined || email.startsWith('-')) usage()
const generate = process.argv.includes('--generate')

try {
  const password = generate ? generatePassword() : await readPassword()

  // The service looks the account up through the same SECURITY DEFINER function
  // the login path uses, so this tool needs no privilege the running
  // application does not already have, and ends every existing session as a
  // password change from inside the app would.
  const resetEmail = await auth.resetPassword(email, password)
  if (resetEmail === undefined) {
    console.error(`No account with the email '${email.trim().toLowerCase()}'. Nothing changed.`)
    process.exit(1)
  }

  console.log(`\nPassword reset for ${resetEmail}. All existing sessions signed out.`)
  if (generate) {
    console.log(`\n  ${password}\n`)
    console.log('That is shown once and not stored anywhere. Save it now.')
  }
} catch (error) {
  console.error('Password reset failed:', error)
  process.exitCode = 1
} finally {
  await db.destroy()
}
