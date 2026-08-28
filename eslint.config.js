// ---------------------------------------------------------------------------
// ONE RULE MATTERS HERE, AND IT IS WHY THIS FILE EXISTS.
//
// `no-undef`. Twice in one day a refactor left a call to a function that had
// been deleted — `setFanMode(false)` in three handlers after the fan detector
// was removed. Vite compiles that happily, because it is valid JavaScript: it is
// only wrong at the moment somebody clicks. And a ReferenceError thrown from a
// React handler unmounts the tree, so the report that comes back is "the screen
// went blank", which points nowhere near the cause.
//
// The 25 scripts in tools/ test geometry, and they test it well. None of them can
// catch a name that does not exist, because that is not a behaviour — it is a
// fact about the source, and a linter is the tool that knows facts about source.
//
// DELIBERATELY NOT A STYLE CONFIG. No formatting rules, no opinions about
// quotes, nothing that would produce a hundred warnings nobody reads and
// therefore a lint step nobody runs. Two rules that catch bugs, and silence
// otherwise. `npm test` runs it, so it cannot rot.
// ---------------------------------------------------------------------------
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';

export default [
  {
    files: ['src/**/*.{js,jsx}', 'api/**/*.js', 'tools/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks, react },
    rules: {
      'no-undef': 'error',
      // WITHOUT THESE TWO, no-unused-vars is worse than useless: it does not
      // know that a component named in JSX is used, so it reports every import
      // in the file and the real signal drowns in forty false positives. A lint
      // rule nobody believes is a lint rule nobody runs.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      // A variable assigned and never read is usually the other half of a
      // half-finished refactor. Args and caught errors are exempt: a signature
      // is a contract, and `catch {}` is often the point.
      'no-unused-vars': ['warn', {
        args: 'none', caughtErrors: 'none',
        varsIgnorePattern: '^_', ignoreRestSiblings: true,
      }],
      // The dependency array being wrong is the one React mistake that produces
      // stale data rather than a crash — the hardest kind to see.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
