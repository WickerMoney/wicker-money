<!-- Outside contributions: typo, docs and small bug-fix PRs only for now.
     For anything larger, open an issue first. See CONTRIBUTING.md.
     PR title: Conventional Commits, same as commit subjects, e.g.
     feat(ui-kit): add brand chart palette -->

## What and why

<!-- What does this change, and why? What would a reviewer miss from the diff alone? -->

## Linked issue

<!-- Closes #123, or "None". -->

## How it was tested

<!-- Commands run and anything checked by hand. For UI changes, add
     screenshots in light AND dark mode. -->

## Checklist

- [ ] Commits use Conventional Commits and are signed off (`git commit -s`)
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` and `pnpm test` pass (CI runs these too)
- [ ] `pnpm test:integration` passes, if this touches data isolation, roles or migrations
- [ ] Tests added or updated for behavior changes
- [ ] UI changes checked in light and dark mode
- [ ] New migrations are new files; no applied migration was edited
- [ ] Money stays `numeric(19,4)` / `string`, or the boundary change is called out above
- [ ] Docs updated where behavior changed (`README.md`, `CHANGELOG.md`, `ROADMAP.md`, or the docs site)

## SDK, ui-kit and plugin contract impact

<!-- Does this change plugin-sdk, the plugin manifest/contract, or a public
     ui-kit token or class? Note the impact on SDK_MAJOR_VERSION and whether
     it's breaking, or write "None". -->

## Related PRs

<!-- Matching changes in wicker-money-dev, wicker-money-marketing or .github,
     or "None". -->
