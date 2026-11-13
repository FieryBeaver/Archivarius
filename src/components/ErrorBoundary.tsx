import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Resets the boundary when this changes (e.g. the page id). */
  resetKey?: string
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '24px 32px', color: 'var(--muted)' }}>
          <p style={{ color: 'var(--danger)' }}>Something broke rendering this page.</p>
          <p style={{ fontSize: 13 }}>{this.state.error.message}</p>
          <button onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      )
    }
    return this.props.children
  }
}
