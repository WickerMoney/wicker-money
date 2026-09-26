import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  /** Named in the fallback so a user can tell which plugin misbehaved. */
  readonly label: string
  readonly children: ReactNode
}
interface State {
  readonly error: Error | null
}

/**
 * Contains a render failure to one subtree.
 *
 * Every plugin route and every plugin widget gets its own. Without this, one
 * broken third-party plugin blanks the whole application — and the plugin
 * author is not someone the host can vet.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.label}] crashed`, error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children
    return (
      <div className="plugin-error" role="alert">
        <strong>{this.props.label} failed to render.</strong>
        <div className="plugin-error__detail">{error.message}</div>
        <button type="button" className="fio-btn" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    )
  }
}
