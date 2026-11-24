import { useEffect, useRef } from 'react'
import { Button } from '@wickermoney/ui-kit'
import type { Debt } from '../models/index.js'

/** Which way a debt moves in the list. */
export type MoveDirection = 'up' | 'down'

/** Props for {@link CustomOrderList}. */
export interface CustomOrderListProps {
  /** The person's debts that are not archived, in their order. */
  readonly debts: readonly Debt[]
  /** Each active debt's chart colour by id. */
  readonly colors: ReadonlyMap<string, string>
  /** A change is being saved: the buttons stay focusable and ignore a click. */
  readonly busy: boolean
  readonly formatMoney: (value: string) => string
  /** Moves one debt a place; resolves to whether the new order was saved. */
  readonly onMove: (debt: Debt, direction: MoveDirection) => Promise<boolean>
}

/** A percentage with its trailing zeros trimmed: `24.9900` is `24.99%`. */
function rate(apr: string): string {
  return `${apr.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')}%`
}

/**
 * The order extra money is aimed in under Custom order: a numbered list with
 * "Move up" and "Move down" on every row.
 *
 * Buttons rather than drag, because a drag cannot be done from a keyboard or
 * with a screen reader, and adds nothing a person cannot do with two buttons on
 * a list of at most fifty. The buttons stay focusable while a request runs (the
 * `busy` prop, never `disabled`), and the one at an end of the list is
 * `aria-disabled` rather than `disabled`, so focus is never dropped when a debt
 * reaches the top or the bottom. After a move the focus goes back to the same
 * button on the moved row, which has been moved in the DOM: moving a focused
 * element blurs it in some browsers, so focus is set again once the new order is
 * on screen. The page announces the new position in its polite live region.
 */
export function CustomOrderList({ debts, colors, busy, formatMoney, onMove }: CustomOrderListProps) {
  const list = useRef<HTMLOListElement>(null)
  const pending = useRef<{ readonly id: string; readonly direction: MoveDirection } | null>(null)
  const order = debts.map((d) => d.id).join(',')

  // Runs after every new order: puts focus back on the button the person pressed.
  useEffect(() => {
    const wanted = pending.current
    if (wanted === null) return
    pending.current = null
    list.current?.querySelector<HTMLElement>(`[data-move="${wanted.id}:${wanted.direction}"]`)?.focus()
  }, [order])

  const move = async (debt: Debt, direction: MoveDirection): Promise<void> => {
    pending.current = { id: debt.id, direction }
    const saved = await onMove(debt, direction)
    // Nothing moved, so nothing will re-render the list: the focus never left.
    if (!saved) pending.current = null
  }

  return (
    <section className="dp-custom" aria-labelledby="dp-custom-heading">
      <h3 id="dp-custom-heading" className="dp-h3">Your payoff order</h3>
      <p className="dp-muted" id="dp-custom-about">
        Extra money goes to the first debt on this list until it is paid off, then to the next. A debt that is paid off
        or not in the plan is skipped. Use Move up and Move down to change the order.
      </p>
      <ol ref={list} className="dp-custom__list" aria-describedby="dp-custom-about">
        {debts.map((d, i) => {
          const first = i === 0
          const last = i === debts.length - 1
          const skipped = !d.included || Number(d.balance) === 0
          return (
            <li key={d.id} className="dp-custom__row">
              <span className="dp-custom__pos" aria-hidden="true">{i + 1}</span>
              <span className="dp-custom__name">
                <span
                  className="dp-swatch"
                  aria-hidden="true"
                  style={{ background: !d.included ? 'transparent' : (colors.get(d.id) ?? 'var(--wm-chart-other)') }}
                />
                <span>
                  {d.name}
                  {!d.included ? <span className="dp-tag">Not in plan</span> : Number(d.balance) === 0 ? <span className="dp-tag">Paid off</span> : null}
                  <span className="dp-sub">
                    {formatMoney(d.balance)} at {rate(d.apr)}{skipped ? ', skipped' : ''}
                  </span>
                </span>
              </span>
              <span className="dp-custom__moves">
                <Button
                  data-move={`${d.id}:up`}
                  busy={busy}
                  aria-disabled={busy || first ? true : undefined}
                  onClick={first ? undefined : () => void move(d, 'up')}
                >
                  Move up<span className="wm-visually-hidden"> {d.name}</span>
                </Button>
                <Button
                  data-move={`${d.id}:down`}
                  busy={busy}
                  aria-disabled={busy || last ? true : undefined}
                  onClick={last ? undefined : () => void move(d, 'down')}
                >
                  Move down<span className="wm-visually-hidden"> {d.name}</span>
                </Button>
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
