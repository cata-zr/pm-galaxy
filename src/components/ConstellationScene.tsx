import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Layout } from '../engine/layout';
import type { RenderState } from '../engine/renderer';
import { allTickets, blockersOf, dueOf, formatDue, progressOf, ticketIndex } from '../model/types';
import type { Constellation } from '../model/types';
import type { CameraRequest } from './ConstellationCanvas';
import { ConstellationCanvas } from './ConstellationCanvas';
import { Legend } from './Legend';
import { TicketPanel } from './TicketPanel';

interface Props {
  constellation: Constellation;
  layout: Layout;
}

const LABEL_MODES: RenderState['labelMode'][] = ['auto', 'all', 'minimal'];

export function ConstellationScene({ constellation, layout }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [labelMode, setLabelMode] = useState<RenderState['labelMode']>('auto');
  const [cameraRequest, setCameraRequest] = useState<CameraRequest>({ kind: 'fit', nonce: 0 });
  const nonce = useRef(0);
  const blockedCursor = useRef(0);

  const index = useMemo(() => ticketIndex(constellation), [constellation]);
  const progress = useMemo(() => progressOf(constellation), [constellation]);
  const blockerTickets = useMemo(() => blockersOf(constellation), [constellation]);
  const due = useMemo(
    () => dueOf(constellation, progress.complete),
    [constellation, progress.complete],
  );

  // Reset the view when switching constellation.
  useEffect(() => {
    setSelected(null);
    setQuery('');
  }, [constellation.id]);

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const hits = allTickets(constellation).filter(
      (t) => t.key.toLowerCase().includes(q) || t.title.toLowerCase().includes(q),
    );
    return new Set(hits.map((t) => t.key));
  }, [query, constellation]);

  const requestCamera = useCallback((req: Omit<CameraRequest, 'nonce'>) => {
    nonce.current += 1;
    setCameraRequest({ ...req, nonce: nonce.current });
  }, []);

  const jumpTo = useCallback(
    (key: string) => {
      setSelected(key);
      requestCamera({ kind: 'focus', key });
    },
    [requestCamera],
  );

  const cycleBlockers = useCallback(() => {
    if (!blockerTickets.length) return;
    const next = blockerTickets[blockedCursor.current % blockerTickets.length];
    blockedCursor.current += 1;
    jumpTo(next.key);
  }, [blockerTickets, jumpTo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        if (e.key === 'Escape') (target as HTMLInputElement).blur();
        return;
      }
      if (e.key === 'Escape') setSelected(null);
      if (e.key === 'f') requestCamera({ kind: 'fit' });
      if (e.key === 'l') {
        setLabelMode((m) => LABEL_MODES[(LABEL_MODES.indexOf(m) + 1) % LABEL_MODES.length]);
      }
      if (e.key === 'b') cycleBlockers();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestCamera, cycleBlockers]);

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !matched?.size) return;
    const first = [...matched][0];
    jumpTo(first);
  };

  const selectedTicket = selected ? index.get(selected) : undefined;

  return (
    <div className="scene">
      <ConstellationCanvas
        className="scene-canvas"
        layout={layout}
        progress={progress.ratio}
        complete={progress.complete}
        selected={selected}
        matched={matched}
        labelMode={labelMode}
        cameraRequest={cameraRequest}
        onSelect={setSelected}
      />

      <div className="scene-overlay scene-top">
        <div className="scene-stats">
          <div className="scene-title">
            <h1>{constellation.epic.title}</h1>
            <span className="mono">{constellation.epic.key}</span>
          </div>
          {due && <div className={`scene-due due-${due.state}`}>{formatDue(due)}</div>}
          <div className="progress wide">
            <div
              className={`progress-bar ${progress.complete ? 'complete' : ''}`}
              style={{ width: `${Math.round(progress.ratio * 100)}%` }}
            />
          </div>
          <div className="scene-counts">
            <span>
              <strong>{progress.done}</strong>/{progress.total} lit
            </span>
            <span className="stat-progress">{progress.inProgress} active</span>
            <button
              className={`stat-blocked-btn ${progress.blocking ? '' : 'muted'}`}
              onClick={cycleBlockers}
              disabled={!progress.blocking}
              title="Jump to the next blocking ticket (b)"
            >
              {progress.blocking} blocking
            </button>
          </div>
        </div>

        <div className="scene-tools">
          <input
            className="search"
            placeholder="Search key or title…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
          {matched && <span className="match-count">{matched.size} match</span>}
          <button onClick={() => requestCamera({ kind: 'fit' })} title="Fit view (f)">
            Fit
          </button>
          <button
            onClick={() =>
              setLabelMode((m) => LABEL_MODES[(LABEL_MODES.indexOf(m) + 1) % LABEL_MODES.length])
            }
            title="Cycle label density (l)"
          >
            Labels: {labelMode}
          </button>
        </div>
      </div>

      <Legend />

      {selectedTicket && (
        <TicketPanel
          constellation={constellation}
          ticket={selectedTicket}
          onClose={() => setSelected(null)}
          onJump={jumpTo}
        />
      )}
    </div>
  );
}
