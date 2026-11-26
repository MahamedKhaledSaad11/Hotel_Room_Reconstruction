import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'An unexpected rendering error occurred.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-surface text-on-surface px-6 text-center">
          <div className="max-w-md w-full rounded-2xl bg-surface-container-lowest border border-border-sand shadow-lg p-8 space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-error-container text-error flex items-center justify-center">
              <span className="material-symbols-outlined text-[26px]">warning</span>
            </div>
            <h1 className="font-headline text-2xl text-on-surface">
              Something interrupted your atelier view
            </h1>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              {this.state.errorMessage}
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-5 py-2.5 rounded-full bg-primary text-on-primary text-xs font-semibold hover:bg-primary-hover transition-colors"
              >
                Reload Atelier
              </button>
              <a
                href="/login"
                className="px-5 py-2.5 rounded-full bg-surface-container text-on-surface text-xs font-semibold hover:bg-surface-container-high transition-colors"
              >
                Return to Sign In
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
