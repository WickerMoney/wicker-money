import { buildApp } from './app.js'
import { AuthService } from './auth/service.js'
import { startSessionPurge } from './auth/startSessionPurge.js'
import { loadConfig } from './config.js'
import { KyselyUnitOfWork } from './data/KyselyUnitOfWork.js'
import { configureTenantContext } from './db/configureTenantContext.js'
import { createDb } from './db/client.js'
import { assertSchemaReady } from './db/healthcheck.js'
import { assertLeastPrivilege } from './db/privileges.js'
import { recordDeployment } from './db/recordDeployment.js'
import { seedBundledPlugins } from './plugins/registry.js'
import { APP_VERSION, GIT_SHA } from './version.js'

const config = loadConfig()
configureTenantContext(config.AUTH_SECRET)
const db = createDb(config.DATABASE_URL)

try {
  await assertSchemaReady(db)
  // Order matters: this one reads core.users, so it needs the schema to exist.
  await assertLeastPrivilege(db)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  await db.destroy()
  process.exit(1)
}

// Bundled plugins follow the image, so they register at boot rather than in a
// migration. Idempotent, and it never re-enables one the user turned off.
await seedBundledPlugins(db)

// Audit convenience only (core.app_deployments) -- never worth failing startup
// over, e.g. on an instance that has not yet run the migration that added it.
try {
  await recordDeployment(db, APP_VERSION, GIT_SHA)
} catch (error) {
  console.error('Failed to record deployment:', error instanceof Error ? error.message : error)
}

const app = buildApp({ db, config })

// Housekeeping only; the app's own AuthService also purges opportunistically on login.
const purgeTimer = startSessionPurge(new AuthService(new KyselyUnitOfWork(db), config), (error) =>
  app.log.error({ err: error }, 'session purge failed'),
)

async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received, shutting down.`)
  clearInterval(purgeTimer)
  await app.close()
  await db.destroy()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

try {
  await app.listen({ port: config.PORT, host: config.HOST })
  console.log(`Wicker Money API listening on ${config.HOST}:${config.PORT}`)
} catch (error) {
  console.error(error)
  await db.destroy()
  process.exit(1)
}
