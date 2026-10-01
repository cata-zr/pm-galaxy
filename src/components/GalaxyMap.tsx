import { useMemo } from 'react';
import type { Layout } from '../engine/layout';
import { dueOf, formatDue, progressOf } from '../model/types';
import type { Constellation, DueInfo, Progress } from '../model/types';
import { ConstellationCanvas } from './ConstellationCanvas';

export type GalaxyFilter = 'all' | 'blocking' | 'soon' | 'overdue' | 'complete';

const FILTERS: { id: GalaxyFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'blocking', label: 'Blocking' },
  { id: 'soon', label: 'Due soon' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'complete', label: 'Completed' },
];

interface Row {
  c: Constellation;
  p: Progress;
  due: DueInfo | null;
}

function matches(row: Row, filter: GalaxyFilter): boolean {
  switch (filter) {
    case 'blocking':
      return row.p.blocking > 0;
    case 'soon':
      return row.due?.state === 'soon';
    case 'overdue':
      return row.due?.state === 'overdue';
    case 'complete':
      return row.p.complete;
    default:
      return true;
  }
}

interface Props {
  constellations: Constellation[];
  layouts: Map<string, Layout>;
  onEnter: (id: string) => void;
  filter: GalaxyFilter;
  onFilter: (filter: GalaxyFilter) => void;
  query: string;
  onQuery: (query: string) => void;
}

export function GalaxyMap({
  constellations,
  layouts,
  onEnter,
  filter,
  onFilter,
  query,
  onQuery,
}: Props) {
  const rows = useMemo<Row[]>(
    () =>
      constellations.map((c) => {
        const p = progressOf(c);
        return { c, p, due: dueOf(c, p.complete) };
      }),
    [constellations],
  );

  const counts = useMemo(() => {
    const out = {} as Record<GalaxyFilter, number>;
    for (const f of FILTERS) out[f.id] = rows.filter((r) => matches(r, f.id)).length;
    return out;
  }, [rows]);

  // The headline is about work still in flight. A shipped constellation would
  // otherwise pull the percentage up and hide how much is actually left.
  const live = rows.filter((r) => !r.p.complete);
  const totals = live.reduce(
    (acc, r) => {
      acc.done += r.p.done;
      acc.total += r.p.total;
      acc.blocking += r.p.blocking;
      return acc;
    },
    { done: 0, total: 0, blocking: 0 },
  );
  const overdue = live.filter((r) => r.due?.state === 'overdue').length;
  const shipped = rows.length - live.length;

  const q = query.trim().toLowerCase();
  const visible = rows.filter(
    (r) =>
      matches(r, filter) &&
      (!q ||
        r.c.epic.title.toLowerCase().includes(q) ||
        r.c.epic.key.toLowerCase().includes(q) ||
        r.c.id.includes(q)),
  );

  return (
    <div className="galaxy">
      <div className="galaxy-head">
        <div className="galaxy-headline">
          <h1>Galaxy map</h1>
          <p>
            <strong>{live.length}</strong>{' '}
            {live.length === 1 ? 'constellation' : 'constellations'} in flight ·{' '}
            <strong>
              {totals.done}/{totals.total}
            </strong>{' '}
            stars lit
            {totals.blocking > 0 && (
              <>
                {' '}
                · <span className="warn">{totals.blocking} blocking</span>
              </>
            )}
            {overdue > 0 && (
              <>
                {' '}
                · <span className="warn">{overdue} overdue</span>
              </>
            )}
            {shipped > 0 && (
              <>
                {' '}
                · <span className="shipped">{shipped} shipped</span>
              </>
            )}
          </p>
          <p className="galaxy-note">Completed constellations are left out of these totals.</p>
        </div>

        <div className="galaxy-controls">
          <input
            className="search"
            placeholder="Find a constellation…"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
          <div className="filters">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                className={`chip-filter ${filter === f.id ? 'active' : ''}`}
                // Clicking the active filter again returns to everything.
                onClick={() => onFilter(filter === f.id ? 'all' : f.id)}
                disabled={f.id !== 'all' && counts[f.id] === 0}
              >
                {f.label}
                <span className="chip-count">{counts[f.id]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="galaxy-empty">
          <p>Nothing matches that.</p>
          <button
            onClick={() => {
              onFilter('all');
              onQuery('');
            }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="galaxy-grid">
          {visible.map(({ c, p, due }) => {
            const layout = layouts.get(c.id)!;
            return (
              <button
                className={`system-card ${p.complete ? 'system-complete' : ''}`}
                key={c.id}
                onClick={() => onEnter(c.id)}
              >
                <div className="system-preview">
                  <ConstellationCanvas
                    layout={layout}
                    progress={p.ratio}
                    complete={p.complete}
                    labelMode="minimal"
                    interactive={false}
                  />
                  {p.complete && <span className="system-badge">✦ Shipped</span>}
                </div>
                <div className="system-body">
                  <div className="system-title">
                    <h2>{c.epic.title}</h2>
                    <span className="mono system-key">{c.epic.key}</span>
                  </div>
                  <div className="progress">
                    <div
                      className={`progress-bar ${p.complete ? 'complete' : ''}`}
                      style={{ width: `${Math.round(p.ratio * 100)}%` }}
                    />
                  </div>
                  <div className="system-stats">
                    <span>
                      <strong>{Math.round(p.ratio * 100)}%</strong> lit
                    </span>
                    <span>
                      {p.total} {p.total === 1 ? 'star' : 'stars'}
                    </span>
                    {p.inProgress > 0 && (
                      <span className="stat-progress">{p.inProgress} active</span>
                    )}
                    {p.blocking > 0 && <span className="stat-blocked">{p.blocking} blocking</span>}
                    {due && <span className={`stat-due due-${due.state}`}>{formatDue(due)}</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
