# @wickermoney/ui-kit

The React components and design tokens used by
[Wicker Money](https://github.com/WickerMoney/wicker-money)'s app shell. Plugins
use the same package so their pages and widgets look like part of the app.

Full documentation lives at [wickermoney.dev](https://wickermoney.dev).

> **Pre-1.0.** Component props and token names can still change between minor
> releases.

## Install

```sh
npm install @wickermoney/ui-kit
# or: pnpm add @wickermoney/ui-kit
```

Peer dependencies: `react` and `react-dom` 19.

## Usage

```tsx
import { Surface, Stat, Button, EmptyState } from '@wickermoney/ui-kit'

export function Summary({ net }: { net: string }) {
  return (
    <Surface title="This month" action={<Button variant="primary">Details</Button>}>
      <Stat label="Net" value={net} tone="auto" />
    </Surface>
  )
}
```

The package entry imports its stylesheets (`tokens.css` and `components.css`)
as a side effect, so your bundler must handle CSS imports. Vite and most modern
bundlers do by default.

**Inside a Wicker Money plugin:** the host already loads these styles, so
components in your widgets are styled with no extra setup. For your plugin's
*own* CSS, use `adoptPluginStyles` from
[`@wickermoney/plugin-sdk/runtime`](https://www.npmjs.com/package/@wickermoney/plugin-sdk).
A federated remote's emitted stylesheet is never requested.

## Components

| Component | Purpose |
|---|---|
| `Surface` | Card/panel with an optional title and header action |
| `Button` | `variant`: `default`, `primary` or `danger` |
| `Field`, `SelectField` | Labelled form inputs |
| `Table` | Typed table: `columns`, `rows`, `rowKey`; `numeric` columns right-align |
| `Stat` | Label + value; `tone="auto"` colours by sign |
| `CategoryOptions`, `orderByParent` | Category `<option>` list grouped under parents |
| `Alert` | Inline error or notice (`role="alert"`) |
| `EmptyState` | Title, hint and an optional action for empty views |
| `Spinner` | Loading indicator |

Every component's props type is exported alongside it (`SurfaceProps`,
`TableProps<T>`, ...).

## Design tokens

All styling goes through CSS custom properties prefixed `--wm-`: surfaces, text,
accent, positive/negative, and a colour-blind-checked chart palette
(`--wm-chart-1` ... `--wm-chart-6`, `--wm-chart-other`). Use the tokens in your
own CSS rather than hard-coding colours, and your UI follows the app's theme.

Tokens have light values on `:root` and dark overrides. Dark mode follows the
system preference unless `data-theme="light"` or `data-theme="dark"` is set on
the root element.

To use the tokens without the components:

```ts
import '@wickermoney/ui-kit/styles.css'
```

## License

[Apache-2.0](./LICENSE). The Wicker Money application is licensed separately
(AGPL-3.0); see the [main repository](https://github.com/WickerMoney/wicker-money).
