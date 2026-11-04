import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  label?: string;
}
interface State {
  error: Error | null;
}

/** Isolates a crash to one panel instead of blanking the terminal. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label ?? 'app'}]`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="panel fault" role="alert">
        <p>{this.props.label ?? 'This panel'} hit an error and was stopped.</p>
        <button type="button" className="ghost" onClick={() => this.setState({ error: null })}>
          Retry
        </button>
      </div>
    );
  }
}
