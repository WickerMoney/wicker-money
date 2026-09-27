import { loadConfig } from '../../config.js'
import { createServices } from '../../composition/createServices.js'
import { KyselyUnitOfWork } from '../../data/KyselyUnitOfWork.js'
import { configureTenantContext } from '../configureTenantContext.js'
import { createDb } from '../client.js'
import { PERSONAS } from './seedPersonas.js'
import { resetSeedUsers } from './resetSeedUsers.js'
import { runPersona } from './seedPersonaRunner.js'

/**
 * Dev/review seed CLI: `pnpm --filter @wickermoney/api seed`.
 *
 * Fills whichever database `.env` already points at — the repo's own
 * `docker-compose.dev.yml` Postgres, or a separate LAN instance provisioned
 * with `New-WickerMoneyDevDatabase.ps1` — with a small, fixed set of personas
 * covering every account type, every transaction shape, every recurrence
 * frequency and both bundled plugins' storage. The goal is a full functional
 * review (sign in, click through every page, exercise every plugin) without a
 * CI run or a redeploy to the LAN copy: `docker compose up -d` (or nothing, if
 * targeting the LAN instance already up), `pnpm --filter @wickermoney/api
 * migrate`, this, then `pnpm dev`.
 *
 * Connects as the APPLICATION role (`DATABASE_URL`), not the owner: every
 * write goes through the same `Services` registry `apps/api/src/app.ts` wires
 * up for real requests, so row-level security, the composite ownership
 * foreign keys and every service-level validation rule apply exactly as they
 * would to a real user — a seeded account is not a special case the app has
 * to trust. The owner connection (`DATABASE_OWNER_URL`, falling back to
 * `DATABASE_URL`) is used only for two things neither RLS nor the app role
 * permits: looking up whether a persona's email already exists, and (with
 * `--reset`) deleting it.
 *
 * Idempotent by skipping: a persona whose email already exists is left alone.
 * `--reset` deletes the three seed users (and, by cascade, everything they
 * own) before seeding again, so a full do-over is `pnpm seed --reset`.
 *
 * Flags:
 *   --reset   Delete the seed personas first, then seed fresh.
 *   --help    Print this and exit.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    printHelp()
    return
  }
  const reset = args.includes('--reset')

  const config = loadConfig()
  configureTenantContext(config.AUTH_SECRET)

  const ownerUrl = process.env['DATABASE_OWNER_URL'] || config.DATABASE_URL
  const ownerDb = createDb(ownerUrl)
  const db = createDb(config.DATABASE_URL)

  try {
    if (reset) {
      const removed = await resetSeedUsers(ownerDb)
      console.log(
        removed === 0
          ? 'Nothing to reset — no seed users existed.'
          : `Reset: removed ${removed} seed user(s) and everything they owned.`,
      )
    }

    const uow = new KyselyUnitOfWork(db)
    const services = createServices(db, uow, config)

    for (const persona of PERSONAS) {
      const outcome = await runPersona({ db, ownerDb, services }, persona)
      const line = `${persona.key.padEnd(8)} <${persona.email}> — ${persona.description}`
      console.log(outcome === 'created' ? `Created: ${line}` : `Skipped (already exists): ${line}`)
    }

    console.log('\nLogins:')
    for (const persona of PERSONAS) {
      console.log(`  ${persona.email}  /  ${persona.password}`)
    }
    console.log('\nSample CSVs for manually exercising the importer live in db/seed/sample-csv/.')
  } catch (error) {
    console.error('Seed failed:', error)
    process.exitCode = 1
  } finally {
    await db.destroy()
    await ownerDb.destroy()
  }
}

function printHelp(): void {
  console.log(`Usage: pnpm --filter @wickermoney/api seed [--reset]

  --reset   Delete the seed personas (and everything they own) before seeding fresh.
  --help    Print this message.

Seeds whichever database DATABASE_URL / DATABASE_OWNER_URL in .env already
point at. Safe to re-run: a persona whose email already exists is skipped.`)
}

await main()
