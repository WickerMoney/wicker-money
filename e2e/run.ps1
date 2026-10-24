<#
.SYNOPSIS
  Runs the end-to-end tests against a throwaway compose stack (Windows, Docker Desktop).
.DESCRIPTION
  Builds the image from this checkout (or uses -Image), brings the stack up, runs
  Playwright in the official Playwright container, then takes everything down
  again. See DEVELOPMENT.md, "End-to-end tests".
.PARAMETER Image
  A ready image to test, for example ghcr.io/wickermoney/wicker-money:edge. When
  omitted, the image is built from this checkout and tagged wickermoney:e2e.
.PARAMETER PlaywrightArgs
  Extra arguments for `playwright test`, for example 'tests/smoke.spec.ts'.
.EXAMPLE
  .\e2e\run.ps1
.EXAMPLE
  .\e2e\run.ps1 -Image ghcr.io/wickermoney/wicker-money:edge
.EXAMPLE
  .\e2e\run.ps1 -PlaywrightArgs 'tests/smoke.spec.ts'
#>
[CmdletBinding()]
param(
  [string]$Image = $env:E2E_IMAGE,
  [string]$PlaywrightArgs = ''
)

# Native commands write progress to stderr; with 'Stop', Windows PowerShell 5.1
# would turn that into an error. Exit codes are checked by hand instead.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $root 'docker/docker-compose.e2e.yml'

if ([string]::IsNullOrWhiteSpace($Image)) {
  $Image = 'wickermoney:e2e'
  Write-Host "Building $Image from $root"
  docker build -f (Join-Path $root 'docker/Dockerfile') -t $Image $root
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Host "Testing the image $Image"
}
$env:E2E_IMAGE = $Image

# The Playwright container image must be the version e2e/package.json pins.
$pkg = Get-Content (Join-Path $root 'e2e/package.json') -Raw | ConvertFrom-Json
$env:E2E_PLAYWRIGHT_VERSION = $pkg.devDependencies.'@playwright/test'
if ([string]::IsNullOrWhiteSpace($env:E2E_PLAYWRIGHT_VERSION)) {
  Write-Error 'Could not read the pinned @playwright/test version from e2e/package.json'
  exit 1
}
$env:E2E_ARGS = $PlaywrightArgs

New-Item -ItemType Directory -Force -Path (Join-Path $root 'e2e/reports') | Out-Null
$compose = @('compose', '-f', $composeFile, '--profile', 'test')

$status = 1
try {
  docker @compose down --volumes --remove-orphans 2>$null | Out-Null
  docker @compose up --wait --detach wickermoney
  if ($LASTEXITCODE -ne 0) {
    Write-Warning 'The stack did not become healthy. Logs:'
    docker @compose logs --no-color
    exit 1
  }

  docker @compose run --rm playwright
  $status = $LASTEXITCODE

  if ($status -ne 0) {
    Write-Warning "Playwright failed (exit $status). App log tail:"
    docker @compose logs --no-color --tail 40 wickermoney
    Write-Host "Report: $(Join-Path $root 'e2e/reports/html/index.html')"
  }
} finally {
  # Always leave nothing behind, whatever the outcome.
  docker @compose down --volumes --remove-orphans 2>$null | Out-Null
}
exit $status
