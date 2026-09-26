import type { Db } from './client.js'

/**
 * Logs one row to `core.app_deployments` for this boot.
 *
 * Best-effort: a failure here (e.g. migration 019 not yet applied on an
 * instance that only just picked up this version) must never stop the API
 * from starting — the deployment log is an audit convenience, not something
 * the app depends on to function. The caller is expected to catch and log.
 *
 * @param db - Application database handle.
 * @param version - The running app version (see `version.ts`).
 * @param gitSha - The commit the running image was built from, or `null`.
 */
export async function recordDeployment(db: Db, version: string, gitSha: string | null): Promise<void> {
  await db.insertInto('core.app_deployments').values({ version, git_sha: gitSha }).execute()
}
