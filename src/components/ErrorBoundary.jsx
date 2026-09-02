import React from 'react';

// ---------------------------------------------------------------------------
// THE WHITE PAGE, PREVENTED.
//
// React's behaviour when a render throws is to unmount the entire tree. Not the
// component that threw — everything. The result is a blank white page with a
// stack trace in a console nobody has open, and the user's report is "the screen
// went blank", which says nothing about where the fault is. It cost us an
// afternoon: a geometry helper handed the wrong shape of object threw during
// render, and the symptom appeared two features away, the instant a door's width
// was set.
//
// A boundary turns that into a legible failure. It does NOT make the bug go away
// and is not meant to: it says what happened, keeps the message where somebody
// can copy it, and offers the two things worth trying. What it protects is
// everything that is not broken — most of all the editor's saved work, since the
// autosave has already written it and a reload comes back to it.
//
// WHY IT IS OUTSIDE THE ROUTER RATHER THAN PER-ROUTE. A crash in the editor and a
// crash in a card grid want the same response, and a boundary per route is a
// boundary somebody forgets to add to the next one.
// ---------------------------------------------------------------------------

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // The stack is the useful half and the console is where it belongs — it
    // survives navigation and can be copied. The screen gets the sentence.
    console.error('[crash] a render threw', error, info?.componentStack);
    this.setState({ info });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-6">
        <div className="w-[min(560px,94%)] bg-surface border border-border rounded-lg p-6 text-left">
          <h2 className="m-0 mb-2.5 text-lg tracking-[-0.025em] text-center">Something in the app crashed</h2>
          <p className="m-0 mb-3.5 text-[12.5px] text-muted leading-[1.6] text-center">
            Not your drawing — a bug in our code. Anything you had done was already
            saved, so reloading comes back to it.
          </p>
          <pre className="my-3.5 px-3 py-[10px] rounded bg-danger-soft border border-danger-line text-danger-ink text-[11.5px] leading-[1.5] whitespace-pre-wrap break-words max-h-[180px] overflow-auto">{String(error.message || error)}</pre>
          <div className="flex gap-1.5 flex-wrap justify-center mt-[22px]">
            <button className="text-xs leading-[1.5] px-3 py-[7px] rounded border border-cta bg-cta text-white cursor-pointer transition-colors duration-[120ms] hover:bg-cta-hover hover:border-cta-hover disabled:opacity-40 disabled:cursor-not-allowed" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button className="text-xs leading-[1.5] px-3 py-[7px] rounded border border-border-strong bg-surface text-ink cursor-pointer transition-colors duration-[120ms] hover:bg-surface-2 hover:border-ink active:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => {
                const text = `${error.stack || error}\n\n${info?.componentStack || ''}`;
                navigator.clipboard?.writeText(text);
              }}>
              Copy the details
            </button>
          </div>
          <p className="m-0 mb-3.5 text-[12.5px] text-muted leading-[1.6] text-center">
            The full stack is in the browser console.
          </p>
        </div>
      </div>
    );
  }
}
