import { Component, type ErrorInfo, type ReactNode } from 'react'

type PreviewErrorBoundaryProps = {
  /** Changing this clears the error (a new file should get a fresh attempt). */
  resetKey: string
  fallback: (message: string) => ReactNode
  children: ReactNode
}

type PreviewErrorBoundaryState = {
  message: string | null
  key: string
}

// PreviewErrorBoundary keeps a renderer that throws from blanking the preview.
// These parsers work on untrusted files; a malformed document should end in a
// readable "cannot preview, download it" state, never in an empty panel.
export class PreviewErrorBoundary extends Component<PreviewErrorBoundaryProps, PreviewErrorBoundaryState> {
  state: PreviewErrorBoundaryState = { message: null, key: this.props.resetKey }

  static getDerivedStateFromError(error: unknown): Partial<PreviewErrorBoundaryState> {
    return { message: error instanceof Error ? error.message : String(error) }
  }

  static getDerivedStateFromProps(
    props: PreviewErrorBoundaryProps,
    state: PreviewErrorBoundaryState,
  ): Partial<PreviewErrorBoundaryState> | null {
    if (props.resetKey !== state.key) {
      return { message: null, key: props.resetKey }
    }
    return null
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.warn('[preview]', 'renderer failed', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.message !== null) {
      return this.props.fallback(this.state.message)
    }
    return this.props.children
  }
}
