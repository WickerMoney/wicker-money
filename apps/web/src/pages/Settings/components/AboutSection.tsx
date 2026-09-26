import { Surface } from '@wickermoney/ui-kit'

/**
 * Version, copyright and contact details.
 *
 * `__APP_VERSION__` is a build-time constant (`vite.config.ts`, `src/vite-env.d.ts`)
 * read from this package's own `package.json`, which the release build stamps
 * from the tag (`docker/stamp-version.mjs`). Outside a release build it is
 * whatever's checked in, normally `0.0.0`.
 */
export function AboutSection() {
  return (
    <Surface title="About">
      <dl className="settings-facts">
        <div><dt>Version</dt><dd>{__APP_VERSION__}</dd></div>
        <div><dt>Copyright</dt><dd>&copy; 2026 Wicker Money - Jeremy Reed</dd></div>
        <div><dt>Contact</dt><dd>support@wicker.money</dd></div>
      </dl>
    </Surface>
  )
}
