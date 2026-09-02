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

// Shared `.btn` look: inherits the surrounding font (buttons don't by default),
// black-on-white with a hairline border, and the hover/active/disabled states
// every button in this dialog shares.
const BTN = "[font:inherit] text-[12px] py-[7px] px-3 rounded border border-border bg-surface text-ink cursor-pointer transition-[background,border-color,color] duration-[120ms] hover:bg-surface-2 hover:border-border-strong active:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface disabled:hover:border-border";

/** Copy, with the button saying so for a beat. A copy that gives no feedback is
 *  one people press three times. */
function CopyButton({ text, label = 'Copy' }) {
  const [said, setSaid] = useState(false);
  if (!text) return null;
  return (
    <button
      className={`${BTN} text-[11px] leading-[1.5] py-0 px-[5px] ml-auto`}
      onClick={() => {
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
    <div className="fixed inset-0 z-[60] grid place-items-center bg-[rgba(20,20,28,.34)] backdrop-blur-[3px]" onClick={onClose}>
      <div className="w-[min(620px,94vw)] max-h-[88vh] flex flex-col overflow-hidden bg-surface border border-border rounded-[14px] p-[20px_20px_18px] shadow-[0_18px_50px_rgba(20,20,40,.18)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-[14px] flex-none">
          <div>
            <h2 className="m-0 mb-1.5 text-[17px] tracking-[-0.01em]">What was sent{roomName ? ` · ${roomName}` : ''}</h2>
            <p className="text-[11.5px] text-muted leading-[1.5] mt-2" style={{ margin: '2px 0 0' }}>
              The two prompts as they actually went, and the model&apos;s replies
              in full. Both prompts live in <code className="font-sans text-[10px] bg-input-bg px-[3px] rounded-[3px] text-ink">src/lib/wallPrompt.js</code>.
            </p>
          </div>
          <button className={`${BTN} ml-auto flex-none`} onClick={onClose}>Close</button>
        </div>

        <div className="flex gap-1.5 mt-[14px] flex-none" role="tablist">
          {CALLS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k}
              className={`flex-1 px-[10px] py-[7px] rounded-lg [font:inherit] text-[11.5px] text-left cursor-pointer border disabled:opacity-40 disabled:cursor-default ${tab === k ? 'border-accent bg-accent-soft text-ink' : 'border-border bg-surface text-muted'}`}
              disabled={!transcript?.[k]}
              title={transcript?.[k] ? '' : 'This call was not made on the last run.'}
              onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        {!call ? (
          <p className="text-[11.5px] text-muted leading-[1.5] mt-2 mr-0 mb-0 ml-0 border-l-2 border-border-strong pl-[9px]" style={{ marginTop: 14 }}>
            {tab === 'second'
              ? 'The second call was never made — the first one found nothing on'
                + ' the walls, so there was nothing to place.'
              : 'Nothing has been sent for this space yet.'}
          </p>
        ) : (<>
          <p className="text-[11.5px] text-muted leading-[1.5] mt-2" style={{ margin: '10px 0 0' }}>
            {CALLS.find(([k]) => k === tab)[2]}
          </p>
          <div className="flex gap-[10px] flex-wrap mt-2 flex-none font-sans text-[10px] text-subtle">
            <span>{call.model}</span>
            {call.sentImages > 0 && (
              <span>{call.sentImages} image{call.sentImages > 1 ? 's' : ''}</span>
            )}
            {call.ms != null && <span>{(call.ms / 1000).toFixed(1)}s</span>}
            {call.usage?.total_tokens != null && <span>{call.usage.total_tokens} tokens</span>}
            {call.bytes != null && <span>{Math.round(call.bytes / 1024)}KB sent</span>}
          </div>

          <div className="flex-[1_1_auto] min-h-0 flex flex-col mt-3">
            <div className="flex items-center gap-2 flex-none mb-[5px]">
              <b className="text-[11.5px]">The prompt</b>
              <span className="text-muted leading-[1.5] m-0 font-sans text-[10px]">{(call.prompt || '').length.toLocaleString()} chars</span>
              <CopyButton text={call.prompt} />
            </div>
            {/* A <pre> AND NOT A <div>. Both of these are whitespace-significant:
                the prompt's indentation is load-bearing in PROMPT 02's rule list,
                and the reply's worksheet is a table drawn in spaces. Reflowed,
                both become unreadable in exactly the place they matter. */}
            <pre className="flex-[1_1_auto] min-h-[90px] overflow-auto m-0 py-[10px] px-3 border border-border rounded-[8px] bg-input-bg font-[ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation_Mono',monospace] text-[10.5px] leading-[1.55] text-ink whitespace-pre-wrap [word-break:break-word]">{call.prompt || '(no text part — this call sent images only)'}</pre>
          </div>

          <div className="flex-[1_1_auto] min-h-0 flex flex-col mt-3">
            <div className="flex items-center gap-2 flex-none mb-[5px]">
              <b className="text-[11.5px]">The reply</b>
              <span className="text-muted leading-[1.5] m-0 font-sans text-[10px]">{(call.reply || '').length.toLocaleString()} chars</span>
              <CopyButton text={call.reply} />
            </div>
            <pre className="flex-[1_1_auto] min-h-[90px] overflow-auto m-0 py-[10px] px-3 border border-border rounded-[8px] bg-input-bg font-[ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation_Mono',monospace] text-[10.5px] leading-[1.55] text-ink whitespace-pre-wrap [word-break:break-word]">{call.reply
              || '(the model returned nothing — see the note on output caps in wallPrompt.js)'}</pre>
          </div>

          {call.error && <p className="text-[11.5px] text-danger-ink leading-[1.5] mt-2 mr-0 mb-0 ml-0 border-l-2 border-danger pl-[9px]" style={{ marginTop: 10 }}>{call.error}</p>}
        </>)}
      </div>
    </div>
  );
}
