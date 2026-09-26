import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from './App.js'

afterEach(() => {
  localStorage.clear()
})

describe('App', () => {
  it('shows the sign-in surface when there is no stored session', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Sign in to Wicker Money' })).toBeDefined()
  })

  it('does not render the shell while signed out', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Sign in to Wicker Money' })
    expect(screen.queryByRole('navigation')).toBeNull()
  })
})
