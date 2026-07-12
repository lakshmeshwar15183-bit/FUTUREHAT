// Lightweight error boundary — prevents a blank white/dark screen on runtime errors.
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    try {
      console.error('[Lumixo] UI crash', error, info.componentStack);
    } catch {
      /* noop */
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fh-error-boundary" role="alert">
          <div className="fh-error-card">
            <div className="fh-error-icon" aria-hidden>
              🎩
            </div>
            <h1>Something went wrong</h1>
            <p>{this.props.fallbackLabel ?? 'Lumixo hit an unexpected error. Your data is safe.'}</p>
            <button type="button" className="fh-error-btn" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button
              type="button"
              className="fh-error-btn ghost"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
