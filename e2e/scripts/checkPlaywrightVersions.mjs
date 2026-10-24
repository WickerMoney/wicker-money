// Fails when the three places that name a Playwright version disagree:
//
//   e2e/package.json            "@playwright/test"  (what the specs run on)
//   apps/web/package.json       "playwright-core"   (what the hostile plugin suite runs on)
//   docker/docker-compose.e2e.yml  E2E_PLAYWRIGHT_VERSION default (the browser image tag)
//
// They have to move together: one Playwright in the lockfile, and a container
// image whose bundled Chromium belongs to it. Run by `pnpm --filter @wickermoney/e2e typecheck`.
import { readFileSync } from 'node:fs'
import { URL, fileURLToPath } from 'node:url'

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const e2e = JSON.parse(read('../package.json')).devDependencies['@playwright/test']
const hostile = (({ dependencies, devDependencies }) => dependencies?.['playwright-core'] ?? devDependencies?.['playwright-core'])(JSON.parse(read('../../apps/web/package.json')))
const compose = /E2E_PLAYWRIGHT_VERSION:-([0-9.]+)\}/.exec(read('../../docker/docker-compose.e2e.yml'))?.[1]

const found = { 'e2e/package.json (@playwright/test)': e2e, 'apps/web/package.json (playwright-core)': hostile, 'docker/docker-compose.e2e.yml (image tag default)': compose }
if (new Set(Object.values(found)).size !== 1) {
  console.error('Playwright versions disagree; they must be the same exact version:')
  for (const [where, version] of Object.entries(found)) console.error(`  ${where}: ${version}`)
  process.exit(1)
}
console.log(`Playwright ${e2e} everywhere`)
