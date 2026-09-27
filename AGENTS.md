# Agent rules for wicker-money

This file applies to this repo (app, `apps/api`, `apps/web`, `packages/plugin-sdk`,
`packages/ui-kit`, bundled plugins). See `CONTRIBUTING.md` for the human-facing
contribution guide and `../../AGENTS.md` (workspace root) for cross-repo rules —
this file is the concrete spec an agent should follow when writing a commit
message or PR description, not a replacement for either.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

- **Type** — one of `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`,
  `ci`, `chore`, `revert`. Use `style` only for whitespace/formatting-only
  changes (rare here — Prettier/ESLint handle most of this already).
- **Scope** — the part of the repo the change is actually about. Prefer one
  of: `api`, `web`, `plugin-sdk`, `ui-kit`, `docker`, `ci`. For a bundled
  plugin, use the plugin's own name: `budgets`, `import-csv`, `insights`,
  `spending-trends`. Omit the scope only when the change genuinely spans
  everything (e.g. a repo-wide lint config bump) or touches root docs
  (`README.md`, `ROADMAP.md`, `CONTRIBUTING.md`, `SECURITY.md`) — use `docs`
  scope for those rather than omitting it.
- **Description** — imperative mood ("add", not "added"/"adds"), lowercase
  after the colon, no trailing period, aim for ≤72 characters on the subject
  line.
- **Body** — explain *what* changed and *why*, not a restatement of the diff.
  Wrap prose at ~72 characters. Skip the body for genuinely trivial changes.
- **Breaking changes** — add `!` after the type/scope (`feat(api)!: ...`) AND
  a `BREAKING CHANGE:` footer describing the break. Relevant here mainly for
  `plugin-sdk`/`ui-kit` public API changes.
- **One logical change per commit.** Do not bundle an unrelated docs fix into
  a feature commit just because both files happened to be open.
- Money is `numeric(19,4)` in PostgreSQL / `string` in TypeScript, never
  `number` — a commit that changes this boundary is worth calling out
  explicitly in the body, not just the diff.
- Every commit needs a DCO sign-off (`git commit -s`) per `CONTRIBUTING.md`.
  An agent proposing a commit should include `-s` in the command it suggests,
  or note the sign-off if it only drafts the message.
- If the right type or scope genuinely isn't clear from the diff, ask rather
  than guessing — don't invent a scope that doesn't appear in this list.

### Examples

```
feat(web): add wordmark logo to app shell nav

fix(api): stop budget rollover from double-counting the first day

docs: replace Gitea release links with GitHub Actions equivalents

ci: add CODEOWNERS, dependabot config and GitHub Actions workflows
```
