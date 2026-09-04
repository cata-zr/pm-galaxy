import { useEffect, useMemo, useState } from 'react';
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

export default function App() {
  const [galaxy, setGalaxy] = useState<Galaxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(readHash);
  // Held here, not in GalaxyMap: the map unmounts while you are inside a
  // constellation, and coming back to a reset filter is annoying.
  const [filter, setFilter] = useState<GalaxyFilter>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    activeSource()
      .load()
      .then((g) => !cancelled && setGalaxy(g))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

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
    for (const c of galaxy?.constellations ?? []) map.set(c.id, layoutConstellation(c));
    return map;
  }, [galaxy]);

  const constellation = galaxy?.constellations.find((c) => c.id === current) ?? null;

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

        <span className="source-label">{galaxy?.sourceLabel ?? ''}</span>
      </header>

      <main className="content">
        {error && <div className="empty">Could not load: {error}</div>}
        {!galaxy && !error && <div className="empty">Charting the sky…</div>}
        {galaxy && constellation && (
          <ConstellationScene
            key={constellation.id}
            constellation={constellation}
            layout={layouts.get(constellation.id)!}
          />
        )}
        {galaxy && !constellation && (
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
      </main>
    </div>
  );
}
