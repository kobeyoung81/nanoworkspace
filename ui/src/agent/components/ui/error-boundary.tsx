import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import i18n from '../../../i18n'
import { Button } from './button'

type Props = {
  children: ReactNode
  // When this changes the boundary clears its error, so switching panels/tabs
  // recovers instead of showing a stale fallback.
  resetKey?: unknown
}

type State = { error: Error | null }

// ErrorBoundary keeps a render error in one panel from unmounting the whole
// application. It logs the failure and shows a compact, recoverable fallback.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[error-boundary]', error, info.componentStack)
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-5 w-5 text-destructive" />
        </div>
        <p className="text-sm font-semibold">{i18n.t('errors.panelCrashed')}</p>
        <p className="max-w-sm break-words text-xs text-muted-foreground">{this.state.error.message}</p>
        <Button variant="outline" size="sm" className="mt-1 h-7" onClick={() => this.setState({ error: null })}>
          {i18n.t('common.retry')}
        </Button>
      </div>
    )
  }
}
