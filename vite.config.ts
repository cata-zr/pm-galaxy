import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import type { Connect } from 'vite';

/**
 * Mounts the production request handler on the dev server.
 *
 * The point is that dev and production run the *same* module at the *same* URL:
 * `/api/galaxy` is served by `server/handler.ts` either way, so there is no
 * second implementation to drift. In production nginx proxies `/api/` to the
 * node service; here it is middleware, and `npm run dev` stays a single command
 * with no second terminal.
 *
 * `ssrLoadModule` rather than a static import, so editing the server hot-reloads
 * instead of needing the dev server restarted.
 */
function constellationApi(env: Record<string, string>): Plugin {
  let cache: { mod: object; handler: Connect.NextHandleFunction } | null = null;

  const handlerFor = async (server: ViteDevServer) => {
    const mod = (await server.ssrLoadModule('/server/handler.ts')) as {
      createHandler: (e: NodeJS.ProcessEnv) => Connect.NextHandleFunction;
    };
    // A reload produces a new module object, which is what invalidates this —
    // memoised so the TTL cache inside the handler survives between requests.
    if (!cache || cache.mod !== mod) {
      cache = { mod, handler: mod.createHandler({ ...process.env, ...env }) };
    }
    return cache.handler;
  };

  return {
    name: 'constellation-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Checked before loading the module so ordinary asset requests are not
        // dragged through the SSR graph.
        if (!req.url?.startsWith('/api/')) return next();
        handlerFor(server).then(
          (handler) => handler(req, res, next),
          (e: unknown) => next(e),
        );
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Third argument '' means "no prefix filter": the server needs JIRA_* and
  // CONSTELLATION_* out of .env, and those must NOT be VITE_-prefixed — a
  // VITE_ variable is substituted into the client bundle as a string literal,
  // which is precisely how an API token ends up published.
  plugins: [react(), constellationApi(loadEnv(mode, process.cwd(), ''))],
}));
