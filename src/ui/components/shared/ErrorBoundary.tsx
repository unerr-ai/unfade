import { AlertTriangle, RefreshCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  /** If true, show a compact inline error instead of the full-page variant */
  compact?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to browser console for local debugging
    console.error("[ErrorBoundary]", error, info.componentStack);
    // Report to server for observability (fire-and-forget)
    try {
      const payload = {
        error: error.message,
        stack: error.stack?.slice(0, 2000),
        component: info.componentStack?.slice(0, 1000),
        url: window.location.pathname,
        ts: new Date().toISOString(),
      };
      navigator.sendBeacon?.("/api/logs/client-error", JSON.stringify(payload));
    } catch {
      // best effort
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      if (this.props.compact) {
        return (
          <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
            <AlertTriangle size={16} className="shrink-0" />
            <span className="flex-1">Something went wrong loading this section.</span>
            <button
              type="button"
              onClick={this.handleReset}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium hover:bg-warning/10 transition-colors"
            >
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        );
      }

      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle size={40} className="mb-4 text-warning opacity-60" />
          <h2 className="mb-2 text-lg font-semibold text-foreground">Something went wrong</h2>
          <p className="mb-1 max-w-md text-sm text-muted">
            This page encountered an unexpected error.
          </p>
          {this.state.error && (
            <p className="mb-4 max-w-md font-mono text-xs text-muted/60">
              {this.state.error.message}
            </p>
          )}
          <button
            type="button"
            onClick={this.handleReset}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-dim"
          >
            <RefreshCw size={14} /> Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
