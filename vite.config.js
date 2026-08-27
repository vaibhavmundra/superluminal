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
  const ROUTES = [['/api/detect', '/api/detect.js'], ['/api/accents', '/api/accents.js']];
  return {
    name: 'api-routes',
    configureServer(server) {
      // Every server-side name the handlers read. A key missing here does not
      // fail loudly — it fails as "the provider is not configured" on a machine
      // where .env.local plainly contains it, which is a bad hour.
      for (const k of ['ROBOFLOW_INFERENCE_KEY', 'ROBOFLOW_WORKFLOW_URL',
                       'ROBOFLOW_ROOMS_WORKFLOW_URL',
                       'OPENAI_API_KEY', 'OPENAI_VISION_MODEL']) {
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
    base: './',
    server: { port: 5178, host: true },
  };
});
