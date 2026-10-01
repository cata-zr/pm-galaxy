import { blocking, childrenOf, ticketIndex, STATUS_LABEL } from '../model/types';
import type { Constellation, Status, Ticket } from '../model/types';

interface Props {
  constellation: Constellation;
  ticket: Ticket;
  onClose: () => void;
  onJump: (key: string) => void;
}

export function StatusDot({ status }: { status: Status }) {
  return <span className={`dot dot-${status}`} aria-hidden />;
}

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge badge-${status}`}>
      <StatusDot status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}

function RelationRow({
  ticket,
  onJump,
  note,
}: {
  ticket: Ticket;
  onJump: (key: string) => void;
  note?: string;
}) {
  return (
    <button className="relation" onClick={() => onJump(ticket.key)} title={ticket.title}>
      <StatusDot status={ticket.status} />
      <span className="relation-key">{ticket.key}</span>
      <span className="relation-title">{ticket.title}</span>
      {note && <span className="relation-note">{note}</span>}
    </button>
  );
}

/**
 * A dependency whose other end is in a different constellation. Not a button:
 * there is nowhere to fly the camera to, because the other ticket has no star
 * on this canvas. Shown anyway — dropping it would be the map quietly claiming
 * nothing is waiting.
 */
function ExternalRow({ keyName }: { keyName: string }) {
  return (
    <div className="relation relation-external">
      <span className="dot dot-external" aria-hidden />
      <span className="relation-key">{keyName}</span>
      <span className="relation-title">outside this constellation</span>
    </div>
  );
}

export function TicketPanel({ constellation, ticket, onClose, onJump }: Props) {
  const index = ticketIndex(constellation);
  const parent = ticket.parent ? index.get(ticket.parent) : undefined;
  const children = childrenOf(constellation, ticket.key);
  const blockedBy = ticket.blockedBy.map((k) => index.get(k)).filter((t): t is Ticket => !!t);
  const blocks = blocking(constellation, ticket.key);
  const blockedByExternal = ticket.blockedByExternal ?? [];
  const blocksExternal = ticket.blocksExternal ?? [];
  const doneChildren = children.filter((c) => c.status === 'done').length;
  // An external blocker's status is not in this constellation, so it cannot be
  // known to be cleared — count it as open rather than silently ignoring it.
  const openBlockers = [
    ...blockedBy.filter((b) => b.status !== 'done').map((b) => b.key),
    ...(ticket.blockedByExternal ?? []),
  ];

  return (
    <aside className="panel">
      <header className="panel-head">
        <div className="panel-key">
          <span className={`level-tag level-${ticket.level}`}>L{ticket.level}</span>
          <span className="mono">{ticket.key}</span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <h2 className="panel-title">{ticket.title}</h2>

      <div className="panel-row">
        <StatusBadge status={ticket.status} />
        <span className="chip">{ticket.issueType}</span>
        {children.length > 0 ? (
          <span className="chip" title="Parent status is rolled up from its children">
            rolled up from {children.length}
          </span>
        ) : (
          ticket.storyPoints !== undefined && <span className="chip">{ticket.storyPoints} pts</span>
        )}
      </div>

      {openBlockers.length > 0 && (
        <div className="alert">
          Waiting on {openBlockers.length} unfinished{' '}
          {openBlockers.length === 1 ? 'dependency' : 'dependencies'}
        </div>
      )}

      <p className="panel-desc">{ticket.description}</p>

      <dl className="meta">
        <div>
          <dt>Assignee</dt>
          <dd>{ticket.assignee ?? 'Unassigned'}</dd>
        </div>
        <div>
          <dt>Sprint</dt>
          <dd>{ticket.sprint ?? '—'}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{new Date(ticket.updated).toLocaleDateString()}</dd>
        </div>
        {ticket.dueDate && (
          <div>
            <dt>Due</dt>
            <dd>{new Date(ticket.dueDate).toLocaleDateString()}</dd>
          </div>
        )}
        <div>
          <dt>Labels</dt>
          <dd>{ticket.labels.join(', ')}</dd>
        </div>
      </dl>

      {children.length > 0 && (
        <section>
          <h3>
            Children <span className="count">{doneChildren}/{children.length} done</span>
          </h3>
          <div className="relations">
            {children.map((c) => (
              <RelationRow key={c.key} ticket={c} onJump={onJump} />
            ))}
          </div>
        </section>
      )}

      {(blockedBy.length > 0 || blockedByExternal.length > 0) && (
        <section>
          <h3>Blocked by</h3>
          <div className="relations">
            {blockedBy.map((b) => (
              <RelationRow
                key={b.key}
                ticket={b}
                onJump={onJump}
                note={b.status === 'done' ? 'cleared' : 'open'}
              />
            ))}
            {blockedByExternal.map((k) => (
              <ExternalRow key={k} keyName={k} />
            ))}
          </div>
        </section>
      )}

      {(blocks.length > 0 || blocksExternal.length > 0) && (
        <section>
          <h3>Blocks</h3>
          <div className="relations">
            {blocks.map((b) => (
              <RelationRow key={b.key} ticket={b} onJump={onJump} />
            ))}
            {blocksExternal.map((k) => (
              <ExternalRow key={k} keyName={k} />
            ))}
          </div>
        </section>
      )}

      {parent && (
        <section>
          <h3>Parent</h3>
          <div className="relations">
            <RelationRow ticket={parent} onJump={onJump} />
          </div>
        </section>
      )}

      <footer className="panel-foot">
        <span className="hint">Double-click a star to centre it · Esc to deselect</span>
      </footer>
    </aside>
  );
}
