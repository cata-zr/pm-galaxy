import { useState } from 'react';

/**
 * One naming scheme throughout: the left column says what the ticket *is*, the
 * right column says how to spot it. No mixing of star types with state labels.
 */
const STARS: { swatch: string; label: string; note: string }[] = [
  { swatch: 'sun', label: 'Epic', note: 'Ignites when every star is lit' },
  { swatch: 'unlit', label: 'Not started', note: 'No light' },
  { swatch: 'blocked', label: 'Blocked', note: 'Ring of orbiting debris' },
  { swatch: 'in_progress', label: 'In progress', note: 'Blue flicker' },
  { swatch: 'blocking', label: 'Blocking others', note: 'Red; pulses to amber while it moves' },
  { swatch: 'done', label: 'Done', note: 'Full starlight' },
];

const PATHS: { swatch: string; label: string; note: string }[] = [
  { swatch: 'line-child', label: 'Parent → child', note: 'Ticket to sub-ticket' },
  { swatch: 'line-open', label: 'Waiting: not started', note: 'Blocker has not begun' },
  { swatch: 'line-active', label: 'Waiting: in progress', note: 'Blocker is moving' },
  { swatch: 'line-clear', label: 'Path clear', note: 'Blocker is done' },
];

/** Open by default only where it fits alongside the constellation. */
const roomForLegend = () => window.matchMedia('(min-width: 1100px) and (min-height: 760px)').matches;

export function Legend() {
  const [open, setOpen] = useState(roomForLegend);
  return (
    <div className={`legend ${open ? '' : 'legend-closed'}`}>
      <button className="legend-toggle" onClick={() => setOpen((o) => !o)}>
        Legend {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="legend-body">
          <div className="legend-group">
            {STARS.map((s) => (
              <div className="legend-row" key={s.label}>
                <span className={`legend-star legend-star-${s.swatch}`} />
                <span className="legend-label">{s.label}</span>
                <span className="legend-note">{s.note}</span>
              </div>
            ))}
          </div>
          <div className="legend-group">
            {PATHS.map((p) => (
              <div className="legend-row" key={p.label}>
                <span className={`legend-line ${p.swatch}`} />
                <span className="legend-label">{p.label}</span>
                <span className="legend-note">{p.note}</span>
              </div>
            ))}
          </div>
          <div className="legend-hint">
            Star size: sun = epic · 30% = ticket · 20% = sub-ticket · 14% = L3
          </div>
        </div>
      )}
    </div>
  );
}
