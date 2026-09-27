# Roadmap

Wicker Money is pre-1.0 and has a single maintainer. This is direction, not a
promise: items move, shrink or disappear, and there are no dates.

<!-- TODO(confirm tiers): the Now / Next / Later grouping and the items under
     Next and Later are a draft compiled from the README and the org profile.
     Confirm the tiers before publishing. -->

## Shipped

| Milestone | What it added |
|---|---|
| M1 | Auth and ledger: users, accounts, categories, rules, transactions, splits, all under row-level security |
| M2 | The shell and the first plugin: Module Federation host, dashboard widgets from plugins, scoped plugin client |
| M3 | Import and categorization: CSV import, category rules with preview, triage tools |

## Now

- Get to a first tagged release (`v0.1.0`): self-hosting quickstart, published
  container image, published `plugin-sdk` and `ui-kit`.
- Hardening the first-run and deployment story (registration policy, secure
  cookie guidance).

## Next

- Forecasting
- A plugin picker (UI to enable and disable plugins)

## Later

- Third-party plugin install. This depends on plugin isolation, which does not
  exist yet; today plugin code runs fully trusted.
- Freezing the plugin API (`SDK_MAJOR_VERSION`) ahead of 1.0.
