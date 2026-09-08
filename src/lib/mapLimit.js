/** Run `fn` over `items`, at most `limit` at a time. */
export const mapLimit = async (items, limit, fn) => {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i], i); }
      catch (err) { out[i] = { error: err }; }
    }
  }));
  return out;
};

