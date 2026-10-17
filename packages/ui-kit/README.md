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
bundlers do by default. `package.json` declares `./dist/index.js` and `./dist/*.css` as the
only files with side effects (`sideEffects`), so a bundler can still drop the
components you never import.

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
| `Field`, `SelectField` | Labelled form inputs; optional `hint` and `error` (wires `aria-invalid` and `aria-describedby`) |
| `FormError` | A form-level error, shown beside the form's submit button |
| `Table` | Typed table: `columns`, `rows`, `rowKey`; `numeric` columns right-align. Optional `caption` names the table: it is rendered as a visually hidden `<caption>` that a screen reader announces. Header cells carry `scope="col"`, and a column whose `header` is an empty string (a column of row buttons) gets a visually hidden "Actions" label in its header cell, so no header cell is empty |
| `Stat` | Label + value; `tone="auto"` colours by sign |
| `CategoryOptions`, `orderByParent` | Category `<option>` list grouped under parents |
| `Alert` | Inline error or notice (`role="alert"`) |
| `EmptyState` | Title, hint and an optional action for empty views |
| `Spinner` | Loading indicator |

### Form errors

`useFormErrors()` holds a form's errors and, after `show()`, moves focus to the
first invalid field (or the `FormError`). `formErrorsFrom(error, fields,
fallback)` maps an API error's `issues: { path, message }[]` to your field
names and returns anything left over as one form-level message;
`validationIssuesOf(error)` reads the issues on their own. `NO_FORM_ERRORS`
and `hasFormErrors` cover the empty case.

Every component's props type is exported alongside it (`SurfaceProps`,
`TableProps<T>`, ...).

### Focus trap

`useFocusTrap(ref, active, options?)` keeps Tab and Shift+Tab inside the element
`ref` points at while `active` is true: Tab from the last tabbable element wraps
to the first, Shift+Tab from the first wraps to the last, and if focus is outside
the container the next Tab pulls it in. Disabled, `inert`, hidden and
`tabindex="-1"` elements are skipped. It does not move focus when it turns on
(you know what should be focused first) and it does not handle Escape. The
container must be mounted whenever `active` is true.

By default, when the trap turns off, focus goes back to whatever had it when the
trap turned on. Pass `{ restoreFocus: false }` (the `restoreFocus` field of
`FocusTrapOptions`, default `true`) when you return focus somewhere more specific
yourself.

```tsx
import { useRef } from 'react'
import { useFocusTrap } from '@wickermoney/ui-kit'

export function Menu({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Menu" tabIndex={-1}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
      <button type="button" onClick={onClose}>Close</button>
    </div>
  )
}
```

It is for hand-rolled modals that are not a native `<dialog>`. A native `<dialog>`
opened with `showModal()` already keeps focus inside, and the kit's own `Dialog`
is one.

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
