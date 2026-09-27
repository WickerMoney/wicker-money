#!/usr/bin/env node
// Stamps the release version into one or more package.json files.
//
// Used by docker/Dockerfile's build stage to give apps/api and apps/web the
// same version the release workflow stamps into every published package (see
// .github/workflows/release.yml, "Set package versions from tag"). Those two
// apps stay `private` so that step never reaches them -- they are built into
// the image, not published -- which is what this closes the gap on: it lets
// the API read its own version back from package.json at boot
// (apps/api/src/version.ts), and lets the web build bake it into the bundle
// (apps/web/vite.config.ts), with the tag as the one place the number
// actually comes from.
//
// Usage: node stamp-version.mjs <version> <package.json path> [<package.json path> ...]

import { readFileSync, writeFileSync } from 'node:fs'

const [version, ...files] = process.argv.slice(2)

if (!version || files.length === 0) {
  console.error('Usage: node stamp-version.mjs <version> <package.json path> [...]')
  process.exit(1)
}

for (const file of files) {
  const pkg = JSON.parse(readFileSync(file, 'utf8'))
  pkg.version = version
  writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`Set ${pkg.name ?? file} to ${version}`)
}
