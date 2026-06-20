'use client';

import { AlertTriangle, RefreshCcw } from 'lucide-react';
import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex min-h-[300px] items-center justify-center">
          <div className="glass-panel max-w-md p-8 text-center">
            <AlertTriangle className="mx-auto h-10 w-10 text-amber-400" />
            <h2 className="mt-4 text-lg font-semibold text-th-text">Something Went Wrong</h2>
            <p className="mt-2 text-sm text-th-text-m">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: undefined })}
              className="dune-button mt-5"
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
