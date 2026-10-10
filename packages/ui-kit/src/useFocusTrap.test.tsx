import { fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { useFocusTrap, type FocusTrapOptions } from './useFocusTrap.js'

function Harness(options: FocusTrapOptions) {
  const [on, setOn] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, on, options)
  return (
    <>
      <button type="button" onClick={() => { setOn((v) => !v) }}>toggle</button>
      {on ? (
        <div ref={ref} tabIndex={-1} data-testid="box">
          <button type="button">first</button>
          <button type="button" disabled>skipped</button>
          <button type="button" tabIndex={-1}>also skipped</button>
          <button type="button">last</button>
        </div>
      ) : null}
    </>
  )
}

// jsdom does not move focus on Tab, so these assert what the hook does with the
// keydown: wrap (and cancel the default) at the edges, otherwise leave it alone.
const tab = (shift = false) => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey: shift })
const click = (el: HTMLElement) => fireEvent.click(el)

describe('useFocusTrap', () => {
  it('wraps Tab from last to first and Shift+Tab from first to last', () => {
    render(<Harness />)
    click(screen.getByText('toggle'))
    const first = screen.getByText('first')
    const last = screen.getByText('last')
    last.focus()
    tab(); expect(document.activeElement).toBe(first)
    tab(true); expect(document.activeElement).toBe(last)
    // Away from the edges the browser's own Tab is left alone.
    first.focus()
    expect(fireEvent.keyDown(first, { key: 'Tab' })).toBe(true)
  })

  it('pulls focus in from the container itself or from outside', () => {
    render(<Harness />)
    click(screen.getByText('toggle'))
    screen.getByTestId('box').focus()
    tab(); expect(document.activeElement).toBe(screen.getByText('first'))
    screen.getByText('toggle').focus()
    tab(true); expect(document.activeElement).toBe(screen.getByText('last'))
  })

  it('returns focus to the previously focused element when it turns off', () => {
    render(<Harness />)
    const toggle = screen.getByText('toggle')
    toggle.focus()
    click(toggle)
    screen.getByText('first').focus()
    click(toggle)
    expect(document.activeElement).toBe(toggle)
  })

  it('leaves focus alone when restoreFocus is false', () => {
    render(<Harness restoreFocus={false} />)
    const toggle = screen.getByText('toggle')
    toggle.focus()
    click(toggle)
    screen.getByText('first').focus()
    click(toggle)
    expect(document.activeElement).not.toBe(toggle)
  })
})
