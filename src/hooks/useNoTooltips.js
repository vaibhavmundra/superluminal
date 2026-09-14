import { useEffect } from 'react';

/* ---------------------------------------------------------------------------
   useNoTooltips — TAKE THE NATIVE TOOLTIPS OFF, WHILE A FLAG IS ON.

   A `title` IS FREE ON A WIDE SCREEN AND EXPENSIVE IN A 380px COLUMN. The rail
   alone carries eleven of them, the shape bar six, and each one paints a box
   the browser sizes to its own text — two or three inches of it, wherever the
   pointer happens to be resting, over the one narrow strip of drawing the
   vertical column has. On the open canvas that box lands on empty page and
   nobody minds.

   WHY THIS IS A DOM SWEEP AND NOT A PROP. Twenty components set a `title`, and
   most of them are three levels under the one that knows which mode the editor
   is in — the rail's cells, the palette buttons inside its flyouts, the keys on
   every contextual bar, the footer's switches. Threading a flag through all of
   them is twenty edits and a twenty-first the next time somebody adds a button;
   a React context is the same twenty edits wearing a hat. There is no CSS for
   it: a native tooltip is the browser's own chrome and no rule reaches it. So
   the rule lives in one place and works on anything that arrives later,
   including a portal rendered outside the shell.

   IT PUTS THEM BACK, WHICH IS THE HALF THAT IS EASY TO FORGET. React does not
   know the attribute went: it will not re-set a `title` prop that has not
   changed, so stripping without restoring would leave the ORDINARY canvas
   silent for the rest of the session once somebody had visited the column. The
   text is parked on `data-lp-title` and read back on the way out.

   ARIA IS UNTOUCHED. Every one of these controls carries a visible label, an
   `aria-label`, or both — a `title` was never the accessible name here — so a
   screen reader reads exactly what it read before.
   --------------------------------------------------------------------------- */

/** Strip one element's tooltip, remembering it. */
const hide = (el) => {
  if (!el?.hasAttribute?.('title')) return;
  el.dataset.lpTitle = el.getAttribute('title');
  el.removeAttribute('title');
};

/** ...and give it back. */
const show = (el) => {
  el.setAttribute('title', el.dataset.lpTitle ?? '');
  delete el.dataset.lpTitle;
};

/**
 * `on` is the flag — vertical mode, today. Nothing happens while it is false,
 * so the ordinary canvas never pays for this: no observer, no sweep.
 */
export default function useNoTooltips(on) {
  useEffect(() => {
    if (!on || typeof MutationObserver !== 'function') return undefined;
    const root = document.body;
    /* WHAT IS ALREADY THERE, then whatever arrives. */
    const sweep = (node) => {
      if (node?.nodeType !== 1) return;
      hide(node);
      node.querySelectorAll?.('[title]').forEach(hide);
    };
    sweep(root);
    /* `attributeFilter` IS WHAT MAKES THIS CHEAP. The observer wakes for a
       `title` and for new nodes, and for nothing else on a canvas that is
       re-rendering forty times a second under a drag. Removing the attribute
       reports itself, and the second pass finds nothing to do — see `hide`. */
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes') hide(r.target);
        else r.addedNodes.forEach(sweep);
      }
    });
    mo.observe(root, { subtree: true, childList: true,
                       attributes: true, attributeFilter: ['title'] });
    return () => {
      mo.disconnect();
      root.querySelectorAll('[data-lp-title]').forEach(show);
    };
  }, [on]);
}
