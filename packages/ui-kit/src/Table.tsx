import { Fragment, type ReactNode } from 'react'

/** Describes one column of a {@link Table}. */
export interface Column<T> {
  /** Stable identifier for the column. */
  readonly key: string
  /**
   * Usually a string, but a node when the header is itself a control, such as a
   * select-all checkbox above a column of row checkboxes.
   */
  readonly header: ReactNode
  /** Right-aligns the column and uses tabular figures, for money and counts. */
  readonly numeric?: boolean
  /** Renders the cell for one row. */
  readonly render: (row: T) => ReactNode
}

/** Props for {@link Table}. */
export interface TableProps<T> {
  /** Column definitions, in display order. */
  readonly columns: readonly Column<T>[]
  /** The data rows to render. */
  readonly rows: readonly T[]
  /** Returns a stable, unique React key for a row. */
  readonly rowKey: (row: T) => string
  /** Rendered instead of the table when `rows` is empty. */
  readonly empty?: ReactNode
  /**
   * An extra class on the table's scroller, for a page that restyles its table
   * (the transactions list turns into stacked cards on phones). Cells carry
   * `data-col` with their column key, and `data-label` with their header when it
   * is text, so that CSS can place them and label them.
   */
  readonly className?: string
  /**
   * A name for the table, announced by screen readers (a visually hidden
   * `<caption>`). Give one whenever a page has more than one table or the
   * heading above it does not say what the rows are.
   */
  readonly caption?: string
  /**
   * Experimental (see the ui-kit README): may change in any 0.x minor release.
   * Returns what to show in a full-width detail row directly under `row`, or
   * `null`, `undefined` or `false` for none. The detail row is
   * `<tr class="wm-table__detail"><td colSpan>` (one cell as wide as the table),
   * and the row it belongs to gets the class `wm-table__row--open`, so that CSS
   * can join the two. It is for what belongs to one row but does not fit in its
   * cells, such as an inline picker. The content is the caller's: move focus into
   * it when it opens and give it an accessible name. Not announced as a table
   * row of its own beyond what the content says.
   */
  readonly rowDetail?: (row: T) => ReactNode
}

/**
 * A data table.
 *
 * Wrapped in its own horizontal scroller so that a wide table does not force the
 * whole page to scroll sideways on a narrow screen. Header cells carry
 * `scope="col"`, and a column with an empty string header (a column of row
 * buttons) gets a visually hidden "Actions" label so no header cell is empty.
 * That label is in the `<th>` only; `data-label` stays unset for it, so the
 * phone card layouts do not print it. The scroller is `position: relative` so
 * that the label is clipped with the table instead of widening the page.
 */
export function Table<T>({ columns, rows, rowKey, empty, className, caption, rowDetail }: TableProps<T>) {
  if (rows.length === 0 && empty !== undefined) return <>{empty}</>
  return (
    <div className={className === undefined ? 'wm-table__scroll' : `wm-table__scroll ${className}`}>
      <table className="wm-table">
        {caption === undefined ? null : <caption className="wm-visually-hidden">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" data-col={c.key} className={c.numeric === true ? 'wm-num' : undefined}>
                {c.header === '' ? <span className="wm-visually-hidden">Actions</span> : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const detail = rowDetail?.(row)
            const open = detail !== undefined && detail !== null && detail !== false
            return (
              <Fragment key={rowKey(row)}>
                <tr className={open ? 'wm-table__row--open' : undefined}>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      data-col={c.key}
                      data-label={typeof c.header === 'string' && c.header !== '' ? c.header : undefined}
                      className={c.numeric === true ? 'wm-num' : undefined}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
                {open ? (
                  <tr className="wm-table__detail">
                    <td colSpan={columns.length}>{detail}</td>
                  </tr>
                ) : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
