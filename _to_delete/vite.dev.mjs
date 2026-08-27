import { createServer } from 'vite';
const s = await createServer({
  configFile: '/sessions/rcw-014p8ljnvjsexi4ig5fqvdtq/mnt/light_planner/vite.config.js',
  root: '/sessions/rcw-014p8ljnvjsexi4ig5fqvdtq/mnt/light_planner',
  // The only override: the dep cache goes somewhere this shell may delete from.
  cacheDir: process.env.HOME + '/.vitecache',
  server: { port: 5179, host: true },
});
await s.listen();
console.log('dev on', s.resolvedUrls?.local?.[0]);
