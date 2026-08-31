import React, { useState } from 'react';

// ---------------------------------------------------------------------------
// PromptTranscript — exactly what went to the model, and exactly what came back.
//
// WHY THIS IS A FEATURE AND NOT A DEBUG LOG. The render pass is two prompts, and
// those prompts are written to be TUNED: wallPrompt.js keeps PROMPT 01 verbatim
// and PROMPT 02 as a template precisely so somebody can go and change the
// wording when a room comes back wrong. You cannot tune a prompt you have to
// take on faith. Half of PROMPT 02 is filled in at runtime — the anchors derived
// from the plan, the grid this room actually got, the elements pasted in from
// the first call — so the file on disk is not the question that was asked, and
// reading the file tells you nothing about why THIS room came back the way it
// did.
//
// AND THE REPLY IS WHERE THE ANSWER ACTUALLY IS. PROMPT 02 asks for a worksheet
// before the JSON: a wall table, an anchor table, a line per element, a
// self-check. That worksheet is the model showing its working — "panelling ->
// W1 because the location says behind the bed and the bed anchor is the top
// wall" — and it is the only place the reason a run landed on the wrong wall is
// ever written down. The panel above shows the conclusion; this shows the
// argument.
//
// TWO CALLS, TWO TABS. Not one long scroll: they are separate questions asked of
// separate pictures, and the second one's prompt CONTAINS the first one's answer,
// so seeing them stacked invites reading the elements array twice.
// ---------------------------------------------------------------------------

const CALLS = [
  ['first', 'PROMPT 01 · the renders', 'What is on the walls, in English. No coordinates asked for.'],
  ['second', 'PROMPT 02 · the gridded plan', 'Where that is, as grid cells. The reply is a worksheet, then the array.'],
];

/** Copy, with the button saying so for a beat. A copy that gives no feedback is
 *  one people press three times. */
function CopyButton({ text, label = 'Copy' }) {
  const [said, setSaid] = useState(false);
  if (!text) return null;
  return (
    <button className="btn tiny" onClick={() => {
      navigator.clipboard?.writeText(text)
        .then(() => { setSaid(true); setTimeout(() => setSaid(false), 1400); })
        .catch(() => {});
    }}>{said ? 'Copied' : label}</button>
  );
}

export default function PromptTranscript({ transcript = null, roomName = null, onClose }) {
  // THE SECOND CALL BY DEFAULT WHERE THERE IS ONE, because it is the one that
  // goes wrong. The first call reads a photograph and is usually right; the
  // second has to tie English to a drawing, and that is the step somebody opens
  // this dialog to interrogate.
  const [tab, setTab] = useState(transcript?.second ? 'second' : 'first');
  const call = transcript?.[tab] ?? null;

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal wide tall" onClick={(e) => e.stopPropagation()}>
        <div className="tx-head">
          <div>
            <h2>What was sent{roomName ? ` · ${roomName}` : ''}</h2>
            <p className="note" style={{ margin: '2px 0 0' }}>
              The two prompts as they actually went, and the model&apos;s replies
              in full. Both prompts live in <code>src/lib/wallPrompt.js</code>.
            </p>
          </div>
          <button className="btn" onClick={onClose}>Close</button>
        </div>

        <div className="tx-tabs" role="tablist">
          {CALLS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k}
              className={tab === k ? 'on' : ''}
              disabled={!transcript?.[k]}
              title={transcript?.[k] ? '' : 'This call was not made on the last run.'}
              onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        {!call ? (
          <p className="note warn" style={{ marginTop: 14 }}>
            {tab === 'second'
              ? 'The second call was never made — the first one found nothing on'
                + ' the walls, so there was nothing to place.'
              : 'Nothing has been sent for this space yet.'}
          </p>
        ) : (<>
          <p className="note" style={{ margin: '10px 0 0' }}>
            {CALLS.find(([k]) => k === tab)[2]}
          </p>
          <div className="tx-meta">
            <span>{call.model}</span>
            {call.sentImages > 0 && (
              <span>{call.sentImages} image{call.sentImages > 1 ? 's' : ''}</span>
            )}
            {call.ms != null && <span>{(call.ms / 1000).toFixed(1)}s</span>}
            {call.usage?.total_tokens != null && <span>{call.usage.total_tokens} tokens</span>}
            {call.bytes != null && <span>{Math.round(call.bytes / 1024)}KB sent</span>}
          </div>

          <div className="tx-block">
            <div className="tx-block-head">
              <b>The prompt</b>
              <span className="note">{(call.prompt || '').length.toLocaleString()} chars</span>
              <CopyButton text={call.prompt} />
            </div>
            {/* A <pre> AND NOT A <div>. Both of these are whitespace-significant:
                the prompt's indentation is load-bearing in PROMPT 02's rule list,
                and the reply's worksheet is a table drawn in spaces. Reflowed,
                both become unreadable in exactly the place they matter. */}
            <pre className="tx-text">{call.prompt || '(no text part — this call sent images only)'}</pre>
          </div>

          <div className="tx-block">
            <div className="tx-block-head">
              <b>The reply</b>
              <span className="note">{(call.reply || '').length.toLocaleString()} chars</span>
              <CopyButton text={call.reply} />
            </div>
            <pre className="tx-text">{call.reply
              || '(the model returned nothing — see the note on output caps in wallPrompt.js)'}</pre>
          </div>

          {call.error && <p className="note err" style={{ marginTop: 10 }}>{call.error}</p>}
        </>)}
      </div>
    </div>
  );
}
