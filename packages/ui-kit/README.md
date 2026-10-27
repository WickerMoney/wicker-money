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
| `IconButton` | Square icon-only button for table rows. `icon` is one of `edit`, `delete`, `disable`, `enable`, `archive`, `history`, `end`, `balance` or `link`; `label` is required and is both the accessible name and the hover tooltip; `variant`: `default` or `danger`. Takes any other native `<button>` attribute |
| `Dialog` | Modal built on the native `<dialog>` (`showModal()`): a side drawer on a desktop window, a full-screen sheet on a phone. `title` is the heading and the accessible name; `describedBy` (optional) is the id of an element in the body that gives its accessible description; `onClose` is called on Escape, the close button or a click on the backdrop. The page behind is inert, Tab stays inside, the first input in the body gets focus, and focus returns to what opened it when it unmounts. Render it only while it is wanted |
| `Field`, `SelectField` | Labelled form inputs; optional `hint` and `error` (wires `aria-invalid` and `aria-describedby`) |
| `FormError` | A form-level error, shown beside the form's submit button |
| `Table` | Typed table: `columns`, `rows`, `rowKey`; `numeric` columns right-align. `empty` is rendered instead of the table when `rows` is empty; `className` adds a class to the table's scroller. Optional `caption` names the table: it is rendered as a visually hidden `<caption>` that a screen reader announces. Header cells carry `scope="col"`, and a column whose `header` is an empty string (a column of row buttons) gets a visually hidden "Actions" label in its header cell, so no header cell is empty. Optional `rowDetail(row)` adds a full-width detail row under a row (experimental, see [Table row detail](#table-row-detail)) |
| `Stat` | Label + value; `tone="auto"` colours by sign |
| `CategoryOptions`, `orderByParent` | Category `<option>` list grouped under parents |
| `Alert` | Inline error or notice (`role="alert"`) |
| `EmptyState` | Title, hint and an optional action for empty views |
| `Spinner` | Loading indicator |
| `ToastProvider`, `ToastViewport`, `useToast` | Notification toasts (experimental, see [Toasts](#toasts)) |

### Form errors

`useFormErrors()` holds a form's errors and, after `show()`, moves focus to the
first invalid field (or the `FormError`). `formErrorsFrom(error, fields,
fallback)` maps an API error's `issues: { path, message }[]` to your field
names and returns anything left over as one form-level message;
`validationIssuesOf(error)` reads the issues on their own. `NO_FORM_ERRORS`
and `hasFormErrors` cover the empty case.

Every component's props type is exported alongside it (`SurfaceProps`,
`TableProps<T>`, ...). The other exported types are `Column<T>` (a `Table` column),
`IconName`, `FieldCommon`, `GroupableCategory`, and the form-error types
`FormErrors`, `FormErrorState`, `FieldMatcher` and `ValidationIssue`.

### Table row detail

> **Stability: experimental.** `Table`'s `rowDetail` prop may change in any 0.x
> minor release, and it is **for the core app only until it has a second user**.
> Every other part of `Table` keeps the "Pre-1.0" rule above.

`rowDetail={(row) => node}` renders `node` in a full-width row directly under
`row`: `<tr class="wm-table__detail"><td colSpan>`. Return `null`, `undefined`
or `false` for no detail row. The row it belongs to gets the class
`wm-table__row--open` (its bottom border is hidden, so the two read as one). Use
it for something that belongs to one row but does not fit in its cells, such as
an inline picker. The content is yours: name it (`role="group"` and
`aria-label`), move focus into it when it opens and back to the control that
opened it when it closes. A page that restyles its table into cards on a phone
styles the detail row itself (`.wm-table__detail`); the cells in it carry no
`data-col`.

### Toasts

> **Stability: experimental.** `ToastProvider`, `ToastViewport`, `useToast` and
> their types may change in any 0.x minor release, and they are **for the core
> app only until a plugin path exists**. A plugin's copy of this package has no
> provider, so `useToast()` throws there with a message saying so; the plugin
> SDK has a reserved `notify` message but no host answers it yet. Every other export, apart from
> `Table`'s `rowDetail`, keeps the "Pre-1.0" rule above.

A toast reports the result of a discrete action ("Deleted 'Coffee'."). State
stays inline, and anything inside a modal stays inline too: a toast cannot be
reached while a modal is open.

```tsx
import { ToastProvider, ToastViewport, useToast } from '@wickermoney/ui-kit'

// Once, above your routes. `routeKey` is optional: when it changes (pass the
// pathname) every toast but errors is cleared.
<ToastProvider routeKey={pathname}>
  <main>
    <ToastViewport />   {/* first child of the page container */}
    <Routes>...</Routes>
  </main>
</ToastProvider>

function DeleteButton() {
  const toast = useToast()
  return (
    <button type="button" onClick={() => {
      closeDialog()                                   // close any dialog first
      toast.show('Deleted Coffee (-$4.50).', { kind: 'success', key: 'txn:delete' })
    }}>Delete</button>
  )
}
```

| Member | Description |
|---|---|
| `useToast()` | Returns `{ show, dismiss }`, stable for the life of the provider. Throws outside a `ToastProvider` |
| `show(message, { kind?, key? })` | Returns an id. `message` is a plain string (keep it under 200 characters). `kind` is `success`, `info` (default), `warning` or `error`. A toast with the same `key` replaces the earlier one in place and is announced again; the id is the same |
| `dismiss(id)` | Removes a visible, waiting or not yet delivered toast |
| `ToastProvider` | Props: `children`, `routeKey?`. Owns the queue and the screen-reader announcer |
| `ToastViewport` | No props. Draws the stack; renders nothing when empty or outside a provider |

How it behaves:

- **Nothing dismisses itself.** There is no duration, no timer and no pause on
  hover: a toast stays until its Close button or Escape (with the toast focused)
  closes it, or the same `key` replaces it. Focus returns to where it was.
- **Announcements.** One always-mounted, visually hidden `role="status"`
  (`aria-live="polite"`, `aria-atomic="true"`) region speaks each toast once;
  warnings and errors are prefixed "Warning: " and "Error: ". Calls in one
  animation frame are announced together. The visible stack is not a live
  region. `show()` never moves focus.
- **Limits.** Three toasts show (two at 560px and below); the rest wait and
  appear as slots free, and an error goes ahead of the queue. "Dismiss all"
  appears from two toasts and closes the ones showing.
- **While a modal is open** (`<dialog>` shown modally, or `aria-modal="true"`)
  delivery is held for up to two seconds. Close the dialog first, then call
  `show()`.
- **Placement.** The viewport is an in-flow banner that sticks at
  `top: var(--wm-toast-offset-top, 0px)`; set that custom property to the bottom
  edge of anything fixed to the top of the window (the app shell does this for
  its phone bar). It pushes the page down rather than covering it. The fade is
  150 ms of opacity and is off under `prefers-reduced-motion`.
- **Tokens.** `--wm-shadow-raised` (light and dark) is new; the rest are existing
  surface, border, text, accent and status colours.

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
