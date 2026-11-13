import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button, Field, IconButton, SelectField, ToastProvider, guardBusy } from './index.js'

// The fallback region is appended straight to <body>, outside React's container; the toast provider's is inside it.
afterEach(() => { document.body.querySelectorAll(':scope > [role="status"]').forEach((el) => { el.remove() }) })

const announced = (): string => Array.from(document.querySelectorAll('[role="status"]')).map((el) => el.textContent ?? '').join('')

describe('Button busy', () => {
  it('stays focusable, is aria-disabled, not disabled, and ignores the click', () => {
    const onClick = vi.fn()
    render(<Button busy onClick={onClick}>Save</Button>)
    const b = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(b.getAttribute('aria-disabled')).toBe('true')
    expect(b.disabled).toBe(false)
    b.focus()
    fireEvent.click(b)
    expect(onClick).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(b)
  })

  it('keeps keyboard focus when it becomes busy while it has it', () => {
    function Harness() {
      const [busy, setBusy] = useState(false)
      return <Button busy={busy} onClick={() => { setBusy(true) }}>Go</Button>
    }
    render(<Harness />)
    const b = screen.getByRole('button', { name: 'Go' })
    b.focus()
    fireEvent.click(b)
    expect(b.getAttribute('aria-disabled')).toBe('true')
    expect(b.disabled).toBe(false)
    expect(document.activeElement).toBe(b)
  })

  it('calls onClick when it is not busy and has no aria-disabled', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)
    const b = screen.getByRole('button', { name: 'Save' })
    expect(b.hasAttribute('aria-disabled')).toBe(false)
    fireEvent.click(b)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('still honours a real disabled beside busy', () => {
    render(<Button busy disabled>Save</Button>)
    const b = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(b.disabled).toBe(true)
  })

  it('submits no form while busy (an implicit submission is a click on the submit button)', () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => { e.preventDefault() })
    render(
      <form onSubmit={onSubmit}>
        <input aria-label="name" />
        <Button type="submit" busy>Save</Button>
      </form>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits when it is not busy', () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => { e.preventDefault() })
    render(<form onSubmit={onSubmit}><input aria-label="name" /><Button type="submit">Save</Button></form>)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('does not let a click reach a parent, as a disabled button would not', () => {
    const parent = vi.fn()
    render(<div onClick={parent}><Button busy>Save</Button></div>)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(parent).not.toHaveBeenCalled()
  })
})

describe('IconButton busy', () => {
  it('behaves the same: focusable, aria-disabled, click ignored', () => {
    const onClick = vi.fn()
    render(<IconButton icon="edit" label="Edit" busy onClick={onClick} />)
    const b = screen.getByRole('button', { name: 'Edit' }) as HTMLButtonElement
    expect(b.getAttribute('aria-disabled')).toBe('true')
    expect(b.disabled).toBe(false)
    b.focus()
    fireEvent.click(b)
    expect(onClick).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(b)
  })
})

describe('Field busy', () => {
  it('is read-only, not disabled, so it keeps focus', () => {
    render(<Field label="Password" busy value="x" onChange={() => undefined} />)
    const input = screen.getByLabelText('Password') as HTMLInputElement
    expect(input.readOnly).toBe(true)
    expect(input.disabled).toBe(false)
    input.focus()
    expect(document.activeElement).toBe(input)
  })
})

describe('SelectField busy', () => {
  function Harness({ busy }: { busy: boolean }) {
    const [v, setV] = useState('a')
    return (
      <SelectField label="Pick" busy={busy} value={v} onChange={(e) => { setV(e.target.value) }}>
        <option value="a">A</option><option value="b">B</option>
      </SelectField>
    )
  }

  it('keeps its value, focus and aria-disabled while busy', () => {
    render(<Harness busy />)
    const select = screen.getByLabelText('Pick') as HTMLSelectElement
    expect(select.getAttribute('aria-disabled')).toBe('true')
    expect(select.disabled).toBe(false)
    select.focus()
    fireEvent.change(select, { target: { value: 'b' } })
    expect(select.value).toBe('a')
    expect(document.activeElement).toBe(select)
  })

  it('changes normally when not busy', () => {
    render(<Harness busy={false} />)
    const select = screen.getByLabelText('Pick') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'b' } })
    expect(select.value).toBe('b')
    expect(select.hasAttribute('aria-disabled')).toBe(false)
  })
})

describe('guardBusy', () => {
  it('returns the handler unchanged when not busy, and nothing to call when there is none', () => {
    const h = vi.fn()
    expect(guardBusy(false, h)).toBe(h)
    expect(guardBusy(undefined, h)).toBe(h)
    expect(guardBusy(false)).toBeUndefined()
  })

  it('cancels a checkbox toggle on a native input while busy', () => {
    const onChange = vi.fn()
    render(<input type="checkbox" aria-label="box" aria-disabled="true" onChange={guardBusy(true, onChange)} />)
    const box = screen.getByLabelText('box') as HTMLInputElement
    fireEvent.click(box)
    expect(onChange).not.toHaveBeenCalled()
    expect(box.checked).toBe(false)
  })
})

describe('the busy announcement', () => {
  it('is spoken in its own polite status region when no toast provider is mounted (a plugin frame)', () => {
    render(<Button busy>Save</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const region = document.querySelector('[role="status"][aria-live="polite"]')
    expect(region?.textContent).toBe('Still working. Try again in a moment.')
    expect(region?.className).toContain('wm-visually-hidden')
  })

  it('uses the toast provider\'s announcer when there is one, and adds no second region', () => {
    render(<ToastProvider><Button busy>Save</Button></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(announced()).toBe('Still working. Try again in a moment.')
  })

  it('is spoken again for a second press', () => {
    render(<Button busy>Save</Button>)
    const b = screen.getByRole('button', { name: 'Save' })
    fireEvent.click(b)
    const first = document.querySelector('[role="status"] span')
    fireEvent.click(b)
    expect(document.querySelector('[role="status"] span')).not.toBe(first)
  })

  it('empties itself after a moment so it is not read twice in browse mode', () => {
    vi.useFakeTimers()
    try {
      render(<Button busy>Save</Button>)
      act(() => { screen.getByRole('button', { name: 'Save' }).click() })
      expect(announced()).not.toBe('')
      act(() => { vi.advanceTimersByTime(2000) })
      expect(announced()).toBe('')
    } finally { vi.useRealTimers() }
  })
})
