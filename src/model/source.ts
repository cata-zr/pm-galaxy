/**
 * The single seam between the UI and wherever the data comes from.
 *
 * There is exactly one source now, and it is the API on our own origin. A
 * browser cannot call Jira directly — the REST API on *.atlassian.net returns
 * no `Access-Control-Allow-Origin` for our origin, so the preflight fails and
 * the browser throws the response away, and an Atlassian API token carries the
 * full permissions of the account so it must never ship in the bundle. The
 * server holds the token and does the Jira→domain mapping (see `server/`).
 *
 * Dummy data has not gone away, it has moved *behind* the API:
 * `CONSTELLATION_SOURCE=dummy` makes `/api/galaxy` serve the fixture. That
 * keeps this file — and the UI — with a single code path either way, and means
 * switching is an env var and a restart rather than a rebuild.
 */
import { deriveGalaxy } from './derive';
import type { Galaxy } from './types';

export interface LoadOptions {
  /** Bypass the server's TTL cache. Only for an explicit user-driven refresh. */
  refresh?: boolean;
}

export interface GalaxySource {
  label: string;
  load(opts?: LoadOptions): Promise<Galaxy>;
}

/** Thrown with the server's own message, which is written to be actionable. */
export class SourceError extends Error {}

export const apiSource: GalaxySource = {
  label: 'API',
  load: async (opts) => {
    let res: Response;
    try {
      const url = opts?.refresh ? '/api/galaxy?refresh=1' : '/api/galaxy';
      res = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch {
      // No response at all: in dev the Vite middleware is part of the dev
      // server, so this almost always means the API container is down.
      throw new SourceError('Could not reach the Constellation API. Is the api service running?');
    }

    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message = (body as { error?: string })?.error;
      throw new SourceError(message || `The API returned ${res.status}.`);
    }
    // Every source gets the same roll-up: parents summarise their children, so
    // an epic can never claim to be done while a sub-task under it is open.
    return deriveGalaxy(body as Galaxy);
  },
};

export function activeSource(): GalaxySource {
  return apiSource;
}
