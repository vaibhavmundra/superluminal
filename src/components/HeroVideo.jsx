import React, { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// THE HOME PAGE'S EIGHT SECONDS OF THE APP ACTUALLY RUNNING.
//
// A silent screen recording of the editor — a plan read, the spaces lit, the
// electrical laid over it — sat beside the promise rather than under it, so the
// claim and the evidence for it are on screen at the same time.
//
// IT IS 1.4MB AND IT MAY NOT COST THE PAGE ANYTHING TO PAINT. `preload="none"`
// alone is not enough: a `<video src>` in the markup is a candidate for the
// browser's own preloader the moment the document parses, and on a cold visit
// that is 1.4MB queued alongside the JS and the font files that draw the words.
// So THE SOURCE IS NOT ATTACHED UNTIL TWO THINGS HAVE BOTH HAPPENED — the page
// has finished loading (or the main thread has gone idle), and the box is
// actually near the viewport. Until then this is a 46KB poster in an aspect
// box, which is what the visitor sees for the first moment anyway.
//
// THE POSTER IS THE VIDEO'S OWN FIRST FRAME (public/superluminal_homepage_
// poster.jpg, ffmpeg -vframes 1 -vf scale=1080:-2 -q:v 5). The handover from
// still to moving picture is then invisible — no flash of black, no reflow —
// and the hero has something to show while the file is still on the wire.
//
// MUTED, AND NOT AS AN AESTHETIC CHOICE. Autoplay without a gesture is only
// permitted for muted video; the recording has no audio track at all, so the
// attribute costs nothing and is the whole reason `play()` is allowed to
// succeed. `playsInline` is the matching permission on iOS, which otherwise
// takes any playing video fullscreen.
// ---------------------------------------------------------------------------
const SRC = '/superluminal_homepage_1440x1024.mp4';
const POSTER = '/superluminal_homepage_poster.jpg';

/** Run once the page has finished loading and the main thread has a moment
 * spare. Returns its own teardown.
 *
 * TWO CLOCKS, AND THE SECOND ONE IS THE POINT. `requestIdleCallback` is the
 * fast path — it fires within a frame or two of `load` on a page that is
 * finished, which is as soon as we want the bytes. But an idle period is
 * something the browser has to OFFER, and it offers none to a document that is
 * hidden: open the site in a background tab and the callback can sit there
 * unfired, timeout and all, leaving the hero as a poster that never becomes a
 * picture. So a plain timer runs alongside it as the guarantee — timers are
 * throttled in the background but they do fire — and `go` is idempotent, so
 * whichever clock arrives first wins and the other is a no-op.
 *
 * IT IS DELIBERATELY NOT `load` ITSELF. The frames right after load are where a
 * React app mounts the rest of itself; 1.4MB opened in the middle of that is
 * the competition this whole component exists to avoid. */
function whenIdle(fn) {
  let done = false;
  let idle = 0;
  let timer = 0;
  const go = () => { if (done) return; done = true; fn(); };
  const cancel = () => {
    if (idle && window.cancelIdleCallback) window.cancelIdleCallback(idle);
    if (timer) clearTimeout(timer);
  };
  const schedule = () => {
    if (window.requestIdleCallback) idle = window.requestIdleCallback(go, { timeout: 1000 });
    timer = window.setTimeout(go, 1200);
  };

  if (document.readyState === 'complete') { schedule(); return cancel; }
  window.addEventListener('load', schedule, { once: true });
  return () => { window.removeEventListener('load', schedule); cancel(); };
}

export default function HeroVideo({ className = '' }) {
  const boxRef = useRef(null);
  const videoRef = useRef(null);
  const [src, setSrc] = useState('');

  // THE OS SETTING IS THE VISITOR'S OWN INSTRUCTION. Reduced motion keeps the
  // poster still and hands over the native controls, so the recording is still
  // reachable by anybody who wants it — it just does not start itself.
  const [still] = useState(() => typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof IntersectionObserver === 'undefined') { setSrc(SRC); return undefined; }

    let observer = null;
    const cancelIdle = whenIdle(() => {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) { setSrc(SRC); observer.disconnect(); observer = null; }
        }
      // A LITTLE AHEAD OF THE FOLD, so a visitor who scrolls towards it meets a
      // running picture rather than the start of a download.
      }, { rootMargin: '200px' });
      observer.observe(box);
    });

    return () => { cancelIdle(); observer?.disconnect(); };
  }, []);

  // The element is mounted from the first paint (so the poster is), which means
  // React setting `src` later does not itself start anything — the source has
  // to be picked up and the play asked for by hand.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !src || still) return;
    // BY HAND, BECAUSE REACT SETS `muted` AS A PROPERTY AND NOT AN ATTRIBUTE,
    // and the autoplay policy is a question asked of the element the moment
    // `play()` is called. This is the one line standing between the two.
    el.muted = true;
    el.load();
    el.play().catch(() => {});
  }, [src, still]);

  // STOP THE DECODER WHEN NOBODY IS LOOKING. Eight seconds on a loop is a frame
  // decoded every 33ms for as long as the tab is open, and a visitor reading the
  // footer is paying for a picture that is off screen.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !src || still || typeof IntersectionObserver === 'undefined') return undefined;
    const watch = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) el.play().catch(() => {});
      else el.pause();
    }, { threshold: 0.1 });
    watch.observe(el);
    return () => watch.disconnect();
  }, [src, still]);

  return (
    /* AN ASPECT BOX AND NOT A HEIGHT, at the recording's own 1440×1024, so the
       column can be any width without the picture ever being letterboxed or the
       layout shifting when the file arrives. The hairline and the 12px corner
       are the app's own window edge — the recording opens on the editor's white
       top bar, and against the page's black ground it needs an edge to read as
       a screen rather than as a hole. */
    <div ref={boxRef}
      className={'relative w-full aspect-[45/32] overflow-hidden rounded-[12px] '
        + 'border border-border/10 bg-black ' + className}>
      <video ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover block"
        src={src || undefined}
        poster={POSTER}
        preload="none"
        autoPlay={!still}
        loop
        muted
        playsInline
        controls={still}
        disablePictureInPicture
        aria-label="A floor plan being read and lit in the Super Luminal editor" />
    </div>
  );
}
