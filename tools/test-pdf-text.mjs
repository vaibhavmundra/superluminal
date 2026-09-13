// tools/test-pdf-text.mjs — reading a PDF page's text without Safari's gap.
//
// THE BUG THIS GUARDS. pdf.js's own `getTextContent()` iterates its stream with
// `for await (const value of readableStream)`, which needs
// `ReadableStream.prototype[Symbol.asyncIterator]` — present in Chrome and
// Firefox, absent in WebKit for ever. In Safari it throws on EVERY PDF, and the
// only visible symptom is that a fully dimensioned drawing is reported as
// carrying no dimensions at all. See src/lib/pdfText.js.
//
// So the fixture below is a stream that deliberately has NO async iterator —
// a Safari-shaped stream. Anything that reaches for `for await` fails here.
import { textContentOf } from '../src/lib/pdfText.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`); } };
const sec = (s) => console.log('\n' + s);

/**
 * A page whose text arrives in chunks over a stream with `getReader()` and
 * NOTHING ELSE — no Symbol.asyncIterator, exactly as WebKit ships it.
 */
function safariPage(chunks, { onParams = () => {} } = {}) {
  return {
    streamTextContent(params) {
      onParams(params);
      let i = 0;
      const stream = {
        getReader: () => ({
          read: async () => (i < chunks.length
            ? { value: chunks[i++], done: false }
            : { value: undefined, done: true }),
        }),
      };
      // Prove the fixture really lacks the thing Safari lacks.
      if (stream[Symbol.asyncIterator] !== undefined) throw new Error('fixture is not Safari-shaped');
      return stream;
    },
  };
}

sec('the fixture is genuinely Safari-shaped');
{
  const p = safariPage([]);
  const s = p.streamTextContent({});
  ok('the stream has no async iterator', s[Symbol.asyncIterator] === undefined);
  ok('...but it does have a reader', typeof s.getReader === 'function');
  // AND THE OLD IMPLEMENTATION WOULD DIE ON IT, which is the point of the test.
  let threw = null;
  try { for await (const _ of s) { void _; } } catch (e) { threw = e; }
  ok('`for await` over it throws, as it does in Safari', !!threw, String(threw));
}

sec('collecting text across chunks');
{
  const chunks = [
    { items: [{ str: '3600' }, { str: '4200' }], styles: { f1: { fontFamily: 'a' } }, lang: 'en' },
    { items: [{ str: '2400' }], styles: { f2: { fontFamily: 'b' } }, lang: 'en' },
  ];
  const out = await textContentOf(safariPage(chunks));
  ok('every item arrives', out.items.length === 3, `${out.items.length}`);
  ok('...in stream order',
     out.items.map((i) => i.str).join(',') === '3600,4200,2400', out.items.map((i) => i.str).join(','));
  ok('styles are merged across chunks', !!out.styles.f1 && !!out.styles.f2);
  ok('the language is taken once', out.lang === 'en');
}

sec('the shape pdf.js would have returned');
{
  const out = await textContentOf(safariPage([]));
  ok('an empty page is an empty list, not a throw', Array.isArray(out.items) && out.items.length === 0);
  ok('...with the other two keys present', 'styles' in out && 'lang' in out);
  ok('and lang is null rather than undefined', out.lang === null, `${out.lang}`);
}

sec('chunks that carry nothing');
{
  const out = await textContentOf(safariPage([
    { items: [{ str: 'a' }], styles: null, lang: null },
    null,
    { items: [], styles: {}, lang: 'fr' },
    { items: [{ str: 'b' }] },
  ]));
  ok('a null chunk is skipped rather than fatal', out.items.length === 2, `${out.items.length}`);
  ok('a chunk with no styles does not blank the rest', out.items.map((i) => i.str).join('') === 'ab');
  ok('the first language seen wins', out.lang === 'fr', `${out.lang}`);
}

sec('the parameters pdf.js is asked for');
{
  let seen = null;
  await textContentOf(safariPage([], { onParams: (p) => { seen = p; } }));
  // Marked content would put entries with no `str` into the list, and
  // normalisation is what turns ligatures back into the characters a dimension
  // is written with. Both matter to what textRuns can read.
  ok('marked content is left out', seen?.includeMarkedContent === false, JSON.stringify(seen));
  ok('normalisation stays on', seen?.disableNormalization === false, JSON.stringify(seen));
}

sec('a stream that fails');
{
  const bad = { streamTextContent: () => ({ getReader: () => ({ read: async () => { throw new Error('worker gone'); } }) }) };
  let threw = null;
  try { await textContentOf(bad); } catch (e) { threw = e; }
  // IT MUST PROPAGATE. The caller turns a throw into "the text layer could not
  // be read" and an empty list into "this drawing has no text" — two different
  // sentences, and swallowing the error here would merge them again.
  ok('a read error propagates rather than reading as an empty page',
     threw?.message === 'worker gone', String(threw));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
