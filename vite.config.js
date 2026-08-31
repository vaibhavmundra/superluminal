import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The API endpoints are Vercel functions in production. In dev there is no
// Vercel, so we mount THE SAME MODULES as middleware rather than writing a
// second implementation that can drift from the first. The keys are read from
// .env.local into process.env here and never reach the client bundle.
function apiRoutes(env) {
  // One middleware per handler file. `/api/accents` is a second endpoint rather
  // than a third branch of the first — see the header of api/accents.js — so it
  // needs mounting here too, and mounting it by hand a second time is how the
  // dev server and production quietly end up with different route lists.
  const ROUTES = [['/api/detect', '/api/detect.js'], ['/api/accents', '/api/accents.js'],
                  ['/api/admin', '/api/admin.js']];
  return {
    name: 'api-routes',
    configureServer(server) {
      // Every server-side name the handlers read. A key missing here does not
      // fail loudly — it fails as "the provider is not configured" on a machine
      // where .env.local plainly contains it, which is a bad hour.
      // THE SUPABASE NAMES ARE HERE TOO, AND TWO OF THEM LOOK WRONG UNTIL YOU
      // READ api/admin.js. That handler needs three things the browser half
      // never gives it: the project URL, the SERVICE key (which bypasses RLS and
      // must never be prefixed), and the ANON key — the last only to ask
      // Supabase to validate the caller's token, which is a public operation.
      // The VITE_-prefixed pair is listed as a fallback because .env.local
      // already carries them and making somebody write the same URL twice is how
      // the two drift apart.
      for (const k of ['ROBOFLOW_INFERENCE_KEY', 'ROBOFLOW_WORKFLOW_URL',
                       'ROBOFLOW_ROOMS_WORKFLOW_URL',
                       'OPENAI_API_KEY', 'OPENAI_VISION_MODEL', 'OPENAI_WALL_MODEL',
                       'SUPABASE_URL', 'SUPABASE_PROJECT_ID', 'SUPABASE_SECRET_KEY',
                       'SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) {
        if (env[k] && !process.env[k]) process.env[k] = env[k];
      }
      for (const [route, file] of ROUTES) {
        server.middlewares.use(route, async (req, res, next) => {
          try {
            const { default: handler } = await server.ssrLoadModule(file);
            await handler(req, res);
          } catch (err) {
            server.config.logger.error(`[${route}] ${err.stack || err}`);
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: String(err.message || err) }));
            } else next(err);
          }
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // '' as the prefix: we want the unprefixed server-side names too. They are
  // used only inside configureServer, so they stay out of the bundle.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), apiRoutes(env)],
    // '/' AND NOT './', AND THE ROUTER IS WHY.
    //
    // A relative base emits `./assets/index-abc.js` in index.html, which
    // resolves against the CURRENT PATH. That is fine for a single-screen app
    // served from the root and fatal the moment there are real URLs: open
    // /projects/8f2c… directly, the host serves index.html (see vercel.json),
    // the browser asks for /projects/assets/index-abc.js, and the app is a
    // white page with two 404s. An absolute base is the only thing that is
    // correct at every depth.
    //
    // The font URLs are unaffected — they are relative imports from inside
    // src/, hashed and rewritten by the bundler. See the header of styles.css
    // for why that matters and what it used to break.
    base: '/',
    server: { port: 5178, host: true },
  };
});
