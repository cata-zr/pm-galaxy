/**
 * The one route, shared verbatim by the dev server and production.
 *
 * In dev it is mounted as Vite middleware (see vite.config.ts); in production
 * `main.ts` serves it over node:http behind nginx. Same module both ways, so
 * "works locally" and "works on the host" cannot drift apart.
 *
 * Why a server exists at all: a browser cannot call Jira directly. The REST API
 * on *.atlassian.net returns no `Access-Control-Allow-Origin` for our origin,
 * so the preflight fails and the browser discards the response — and the API
 * token must not ship in a bundle nginx serves to anyone. Server-to-server HTTP
 * has no origin, so this hop sidesteps CORS entirely and keeps the credential
 * on the host.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dummyGalaxy } from '../src/model/dummy';
import type { Galaxy } from '../src/model/types';
import { ConfigError, readConfig, type Config } from './config';
import { createCache } from './cache';
import { buildGalaxy } from './galaxy';
import { JiraError } from './jira';

function loader(config: Config): () => Promise<Galaxy> {
  if (config.mode === 'dummy') {
    // Kept so the visual layer can be worked on without a Jira connection —
    // `vault-rotation` is the only 100%-complete constellation in existence and
    // the only way to exercise the sun's ignition. The roll-up runs on the
    // client for every source, so this hands over raw leaf statuses like Jira.
    return async () => ({ ...dummyGalaxy(), sourceLabel: 'Dummy data (no Jira connection)' });
  }
  return () => buildGalaxy(config.jira!);
}

export interface Handler {
  (req: IncomingMessage, res: ServerResponse, next?: () => void): void;
}

export function createHandler(env: NodeJS.ProcessEnv = process.env): Handler {
  // Read once at startup so a bad configuration fails loudly and immediately
  // rather than on whoever happens to load the page first.
  let config: Config | null = null;
  let configError: string | null = null;
  try {
    config = readConfig(env);
  } catch (e) {
    configError = e instanceof ConfigError ? e.message : String(e);
  }

  const cache = config ? createCache(config.jira?.cacheTtlMs ?? 0, loader(config)) : null;

  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/galaxy') {
      if (next) return next();
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return void res.end(JSON.stringify({ error: 'Not found' }));
    }

    const send = (status: number, body: unknown) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        // Never cache this: the TTL cache upstream is the only cache that
        // should exist, and a stale galaxy is worse than a slow one.
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };

    if (configError || !cache) return send(500, { error: configError ?? 'Not configured' });

    cache
      .get(url.searchParams.get('refresh') === '1')
      .then(({ value, cached }) => send(200, { ...value, cached }))
      .catch((e: unknown) => {
        const status = e instanceof JiraError ? 502 : 500;
        send(status, { error: e instanceof Error ? e.message : String(e) });
      });
  };
}
