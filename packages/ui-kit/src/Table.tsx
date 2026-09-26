import type { ReactNode } from 'react'

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
}

/**
 * A data table.
 *
 * Wrapped in its own horizontal scroller so that a wide table does not force the
 * whole page to scroll sideways on a narrow screen.
 */
export function Table<T>({ columns, rows, rowKey, empty }: TableProps<T>) {
  if (rows.length === 0 && empty !== undefined) return <>{empty}</>
  return (
    <div className="fio-table__scroll">
      <table className="fio-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.numeric === true ? 'fio-num' : undefined}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric === true ? 'fio-num' : undefined}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
