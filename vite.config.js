import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The detection endpoint is a Vercel function in production. In dev there is no
// Vercel, so we mount THE SAME MODULE as middleware rather than writing a
// second implementation that can drift from the first. The key is read from
// .env.local into process.env here and never reaches the client bundle.
function detectApi(env) {
  return {
    name: 'detect-api',
    configureServer(server) {
      // Every server-side name the handler reads. A key missing here does not
      // fail loudly — it fails as "the provider is not configured" on a machine
      // where .env.local plainly contains it, which is a bad hour.
      for (const k of ['ROBOFLOW_INFERENCE_KEY', 'ROBOFLOW_WORKFLOW_URL',
                       'OPENAI_API_KEY', 'OPENAI_VISION_MODEL']) {
        if (env[k] && !process.env[k]) process.env[k] = env[k];
      }
      server.middlewares.use('/api/detect', async (req, res, next) => {
        try {
          const { default: handler } = await server.ssrLoadModule('/api/detect.js');
          await handler(req, res);
        } catch (err) {
          server.config.logger.error(`[detect] ${err.stack || err}`);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: String(err.message || err) }));
          } else next(err);
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // '' as the prefix: we want the unprefixed server-side names too. They are
  // used only inside configureServer, so they stay out of the bundle.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), detectApi(env)],
    base: './',
    server: { port: 5178, host: true },
  };
});
