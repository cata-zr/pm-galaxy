import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConstellationScene } from './components/ConstellationScene';
import { GalaxyMap, type GalaxyFilter } from './components/GalaxyMap';
import { layoutConstellation, type Layout } from './engine/layout';
import { activeSource } from './model/source';
import type { Galaxy } from './model/types';

/** The route lives in the URL hash so a view can be shared or bookmarked. */
function readHash(): string | null {
  const id = window.location.hash.replace(/^#\/?/, '').trim();
  return id ? id : null;
}

function syncedAt(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ''
    : at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * What the source noticed while loading. Worth a banner rather than a log line:
 * an unmapped Jira status is otherwise found by noticing a star is the wrong
 * colour, which is a terrible way to discover a typo in an env var.
 */
function Diagnostics({ galaxy }: { galaxy: Galaxy }) {
  const [dismissed, setDismissed] = useState(false);
  const d = galaxy.diagnostics;
  if (!d || dismissed) return null;

  const notes: string[] = [];
  if (d.unmappedStatuses.length) {
    notes.push(
      `${d.unmappedStatuses.length} Jira ${
        d.unmappedStatuses.length === 1 ? 'status' : 'statuses'
      } fell back to their category because nothing mapped them: ` +
        `${d.unmappedStatuses.join(', ')}. Add them to JIRA_STATUS_TODO / ` +
        `JIRA_STATUS_IN_PROGRESS / JIRA_STATUS_BLOCKED / JIRA_STATUS_DONE.`,
    );
  }
  if (d.clampedLevels) {
    notes.push(
      `${d.clampedLevels} ${d.clampedLevels === 1 ? 'ticket' : 'tickets'} sit deeper than L3 ` +
        `and were drawn at L3.`,
    );
  }
  if (d.externalLinks) {
    notes.push(
      `${d.externalLinks} ${d.externalLinks === 1 ? 'dependency' : 'dependencies'} cross ` +
        `between constellations. They are counted and listed in the ticket panel, but not ` +
        `drawn — there is no star to draw them to.`,
    );
  }
  if (!notes.length) return null;

  return (
    <div className="notice">
      <div className="notice-body">
        {notes.map((n) => (
          <p key={n}>{n}</p>
        ))}
      </div>
      <button className="icon-btn" onClick={() => setDismissed(true)} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

export default function App() {
  const [galaxy, setGalaxy] = useState<Galaxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<string | null>(readHash);
  // Held here, not in GalaxyMap: the map unmounts while you are inside a
  // constellation, and coming back to a reset filter is annoying.
  const [filter, setFilter] = useState<GalaxyFilter>('all');
  const [query, setQuery] = useState('');

  const apply = useCallback((result: { galaxy: Galaxy | null; error: string | null }) => {
    // A failed *refresh* keeps the galaxy it already had: a stale map plus a
    // warning beats throwing away a working view because one poll failed.
    if (result.galaxy) setGalaxy(result.galaxy);
    setError(result.error);
    setLoading(false);
  }, []);

  const fetchGalaxy = useCallback(async (refresh: boolean) => {
    try {
      return { galaxy: await activeSource().load({ refresh }), error: null };
    } catch (e) {
      return { galaxy: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // `loading` already starts true, so there is deliberately no setState here
    // before the await — an effect should not kick off another render.
    void fetchGalaxy(false).then((r) => {
      if (!cancelled) apply(r);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchGalaxy, apply]);

  const refresh = () => {
    setLoading(true);
    setError(null);
    void fetchGalaxy(true).then(apply);
  };

  useEffect(() => {
    const onHash = () => setCurrent(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = (id: string | null) => {
    window.location.hash = id ? `/${id}` : '';
    setCurrent(id);
  };

  // Layouts are expensive-ish and must be stable — compute once per galaxy.
  const layouts = useMemo(() => {
    const map = new Map<string, Layout>();
    // The index picks a flat galaxy's silhouette, so neighbours never share one.
    galaxy?.constellations.forEach((c, i) => map.set(c.id, layoutConstellation(c, i)));
    return map;
  }, [galaxy]);

  const constellation = galaxy?.constellations.find((c) => c.id === current) ?? null;
  // Zero epics is a legitimate answer, not a failure: the discovery query
  // matched nothing. It needs its own state or it reads as a broken app.
  const empty = Boolean(galaxy) && galaxy!.constellations.length === 0;

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => navigate(null)}>
          <span className="brand-dot" />
          Constellation
        </button>

        {constellation && (
          <button className="backlink" onClick={() => navigate(null)}>
            ← Galaxy map
          </button>
        )}

        <span className="source-label">
          {galaxy?.sourceLabel ?? ''}
          {galaxy?.fetchedAt && <span className="synced"> · synced {syncedAt(galaxy.fetchedAt)}</span>}
        </span>
        <button className="refresh" onClick={refresh} disabled={loading}>
          {loading ? 'Syncing…' : 'Refresh'}
        </button>
      </header>

      <main className="content">
        {error && !galaxy && (
          <div className="empty">
            <h2>Could not load the galaxy</h2>
            <p className="empty-detail">{error}</p>
            <button className="chip-btn" onClick={refresh}>
              Try again
            </button>
          </div>
        )}
        {!galaxy && !error && <div className="empty">Charting the sky…</div>}
        {empty && !error && (
          <div className="empty">
            <h2>No epics found</h2>
            <p className="empty-detail">
              This query matched nothing in Jira:
            </p>
            {galaxy?.diagnostics?.epicJql && (
              <p className="empty-detail">
                <code>{galaxy.diagnostics.epicJql}</code>
              </p>
            )}
            <p className="empty-detail">
              Run it in Jira's own issue search to compare. If it works there but not here,
              run <code>npm run diagnose</code> — it checks the credentials and narrows down
              which clause is excluding everything. Otherwise adjust{' '}
              <code>CONSTELLATION_LABEL</code>, or set <code>JIRA_EPIC_JQL</code> to point at a
              project directly.
            </p>
          </div>
        )}
        {galaxy && !empty && (
          <>
            {error && (
              <div className="notice notice-error">
                <div className="notice-body">
                  <p>Refresh failed, so this is the last galaxy that loaded: {error}</p>
                </div>
              </div>
            )}
            {!constellation && !error && <Diagnostics galaxy={galaxy} />}
            {constellation ? (
              <ConstellationScene
                key={constellation.id}
                constellation={constellation}
                layout={layouts.get(constellation.id)!}
              />
            ) : (
              <GalaxyMap
                constellations={galaxy.constellations}
                layouts={layouts}
                onEnter={(id) => navigate(id)}
                filter={filter}
                onFilter={setFilter}
                query={query}
                onQuery={setQuery}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
