import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary.js'

/**
 * Throws while `boom` is set.
 *
 * Deliberately not a self-clearing counter: React re-runs a failed render to
 * collect the component stack, so a component that "throws once" quietly
 * succeeds on the retry and the boundary never engages.
 */
let boom = true
function Flaky() {
  if (boom) throw new Error('widget exploded')
  return <p>recovered</p>
}

/**
 * React 19 reports every error a boundary catches to `onCaughtError`, whose
 * default hands it to the global error reporter. Vitest sees that as an
 * unhandled error and fails the run — even though catching it is the whole
 * point of the component under test. Absorbing it here leaves a genuinely
 * unhandled error still able to fail the suite.
 */
const contained = { onCaughtError: () => {} }

beforeEach(() => {
  boom = true
  // React also logs the component stack; silenced so it does not bury a real
  // failure in the output.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('names the failing subtree and shows the reason', () => {
    render(
      <ErrorBoundary label="Insights · Where it went">
        <Flaky />
      </ErrorBoundary>,
      contained,
    )

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Insights · Where it went failed to render.')
    expect(alert.textContent).toContain('widget exploded')
  })

  it('contains the failure — a sibling boundary keeps rendering', () => {
    render(
      <div>
        <ErrorBoundary label="Broken widget">
          <Flaky />
        </ErrorBoundary>
        <ErrorBoundary label="Healthy widget">
          <p>still here</p>
        </ErrorBoundary>
      </div>,
      contained,
    )

    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByText('still here')).toBeDefined()
  })

  it('renders children again after Try again', () => {
    render(
      <ErrorBoundary label="Flaky widget">
        <Flaky />
      </ErrorBoundary>,
      contained,
    )
    expect(screen.getByRole('alert')).toBeDefined()

    boom = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(screen.getByText('recovered')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
