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
      <div className="page-centre">
        <div className="notice-card crash">
          <h2>Something in the app crashed</h2>
          <p>
            Not your drawing — a bug in our code. Anything you had done was already
            saved, so reloading comes back to it.
          </p>
          <pre className="crash-msg">{String(error.message || error)}</pre>
          <div className="btnrow centre">
            <button className="btn primary" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button className="btn secondary"
              onClick={() => {
                const text = `${error.stack || error}\n\n${info?.componentStack || ''}`;
                navigator.clipboard?.writeText(text);
              }}>
              Copy the details
            </button>
          </div>
          <p className="note">
            The full stack is in the browser console.
          </p>
        </div>
      </div>
    );
  }
}
