import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CheckDuplicatesAction } from './CheckDuplicatesAction.js'

describe('CheckDuplicatesAction', () => {
  it('stays focusable and ignores a press while the check runs', () => {
    const onCheck = vi.fn()
    render(<CheckDuplicatesAction hasRows busy accountMissing={false} onCheck={onCheck} />)
    const button = screen.getByRole('button', { name: 'Checking…' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect((button as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(button)
    expect(onCheck).not.toHaveBeenCalled()
  })

  it('is really disabled while no account is chosen, which is not a request in flight', () => {
    render(<CheckDuplicatesAction hasRows busy={false} accountMissing onCheck={() => undefined} />)
    expect((screen.getByRole('button', { name: 'Check for duplicates' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('runs the check when idle', () => {
    const onCheck = vi.fn()
    render(<CheckDuplicatesAction hasRows busy={false} accountMissing={false} onCheck={onCheck} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check for duplicates' }))
    expect(onCheck).toHaveBeenCalledTimes(1)
  })
})
