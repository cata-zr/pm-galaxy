/**
 * Domain model. Deliberately Jira-shaped but Jira-agnostic: the renderer only
 * ever sees these types, so swapping the dummy source for a real Jira source
 * (see model/source.ts) requires no changes anywhere else.
 */

/** Normalised status. Jira status categories map onto this in the adapter. */
export type Status = 'todo' | 'in_progress' | 'blocked' | 'done';

/** 0 = epic/project, 1 = ticket, 2 = sub-ticket, 3 = reserved for the future. */
export type Level = 0 | 1 | 2 | 3;

export interface Ticket {
  /** Jira key, e.g. "AETCOE-123456". Unique across the galaxy. */
  key: string;
  title: string;
  level: Level;
  status: Status;
  /** Jira issue type name, shown in the detail panel. */
  issueType: string;
  /** Parent key. `null` only for the L0 epic. */
  parent: string | null;
  /** Keys this ticket is blocked by, inside this constellation. */
  blockedBy: string[];
  /**
   * Dependencies whose other end sits in a *different* constellation (or
   * outside the galaxy entirely). They are kept apart from `blockedBy` because
   * `engine/layout.ts` positions one constellation at a time and has no
   * coordinates to draw them to — but they still have to be counted and shown,
   * or a ticket holding up another project would read as a quiet grey star.
   * Listed as text in `TicketPanel`; never drawn as an arc.
   */
  blockedByExternal?: string[];
  /** Keys outside this constellation that are blocked by this ticket. Folded
   *  into `StarNode.blocks`, so such a ticket still goes red. */
  blocksExternal?: string[];
  assignee?: string;
  storyPoints?: number;
  sprint?: string;
  /**
   * ISO date (Jira `fields.duedate`). Optional everywhere; on the L0 epic it is
   * the constellation's deadline, which is the only place the UI reads it.
   */
  dueDate?: string;
  /** ISO date. */
  updated: string;
  description: string;
  labels: string[];
}

export interface Constellation {
  /** Stable id used in the URL hash. */
  id: string;
  /** The L0 epic — the sun. */
  epic: Ticket;
  /** Every L1+ descendant, flat. */
  tickets: Ticket[];
}

/**
 * What the source noticed while loading, surfaced in the UI rather than buried
 * in a log. A mis-set `JIRA_STATUS_*` variable is otherwise diagnosed by
 * noticing a star is the wrong colour, which is no way to find it.
 */
export interface SourceDiagnostics {
  /** Jira status names that matched no configured mapping. */
  unmappedStatuses: string[];
  /** Tickets found deeper than L3 and clamped to it. */
  clampedLevels: number;
  /** Dependency links pointing outside their own constellation. */
  externalLinks: number;
  /** How many epics the discovery query matched. */
  epics: number;
  /** The discovery query that ran. Shown when it matched nothing, so "no epics
   *  found" can be checked against what was actually asked. */
  epicJql?: string;
}

export interface Galaxy {
  constellations: Constellation[];
  /** Where the data came from, shown in the header. */
  sourceLabel: string;
  fetchedAt: string;
  diagnostics?: SourceDiagnostics;
}

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

export const STATUS_LABEL: Record<Status, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
};

export function allTickets(c: Constellation): Ticket[] {
  return [c.epic, ...c.tickets];
}

export function ticketIndex(c: Constellation): Map<string, Ticket> {
  return new Map(allTickets(c).map((t) => [t.key, t]));
}

export interface Progress {
  done: number;
  total: number;
  ratio: number;
  /** Unfinished tickets that other tickets are waiting on. */
  blocking: number;
  inProgress: number;
  /** Every ticket is done — the sun ignites. */
  complete: boolean;
}

/** Progress over the leaf-bearing work items (everything below the epic). */
export function progressOf(c: Constellation): Progress {
  const total = c.tickets.length;
  const done = c.tickets.filter((t) => t.status === 'done').length;
  const inProgress = c.tickets.filter((t) => t.status === 'in_progress').length;
  const blocking = blockersOf(c).length;
  return {
    done,
    total,
    ratio: total ? done / total : 0,
    blocking,
    inProgress,
    complete: total > 0 && done === total,
  };
}

// ---------------------------------------------------------------------------
// Due dates
// ---------------------------------------------------------------------------

/**
 * Where a constellation stands against its deadline. `met` wins over everything
 * once the work is finished: a shipped project is never late, whatever the date
 * says.
 */
export type DueState = 'clear' | 'soon' | 'overdue' | 'met';

export interface DueInfo {
  /** The raw ISO date off the epic. */
  date: string;
  /** Whole days until due; negative once past. */
  days: number;
  state: DueState;
}

/** A constellation counts as "due soon" inside this many days. */
export const NEAR_DUE_DAYS = 14;

/**
 * `complete` is passed in rather than derived so callers that already computed
 * `progressOf` don't walk the ticket list twice.
 */
export function dueOf(c: Constellation, complete: boolean, now: Date = new Date()): DueInfo | null {
  const date = c.epic.dueDate;
  if (!date) return null;
  const at = Date.parse(date);
  if (Number.isNaN(at)) return null;
  // Round up so "later today" reads as 0 days rather than a fraction.
  const days = Math.ceil((at - now.getTime()) / 86_400_000);
  const state: DueState = complete
    ? 'met'
    : days < 0
      ? 'overdue'
      : days <= NEAR_DUE_DAYS
        ? 'soon'
        : 'clear';
  return { date, days, state };
}

const DUE_DATE_FMT: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };

/** Short human form for a due date, e.g. "9 days left" / "overdue by 6 days". */
export function formatDue(d: DueInfo): string {
  // Once it shipped the date stopped mattering — don't make people read it.
  if (d.state === 'met') return 'delivered';
  const on = new Date(d.date).toLocaleDateString(undefined, DUE_DATE_FMT);
  if (d.state === 'clear') return `due ${on}`;
  if (d.days < 0) {
    const late = -d.days;
    return `overdue by ${late} ${late === 1 ? 'day' : 'days'}`;
  }
  if (d.days === 0) return 'due today';
  return `${d.days} ${d.days === 1 ? 'day' : 'days'} left`;
}

/** Keys that at least one other ticket is blocked by. */
export function blockerKeys(c: Constellation): Set<string> {
  const keys = new Set<string>();
  for (const t of allTickets(c)) for (const b of t.blockedBy) keys.add(b);
  return keys;
}

/**
 * The tickets actually holding the constellation up: blockers that aren't done.
 *
 * Counts dependents outside this constellation too. Without that, a ticket
 * blocking another project would be missing from the galaxy's "blocking"
 * headline — the one number principle 1 calls the most useful on the map.
 */
export function blockersOf(c: Constellation): Ticket[] {
  const keys = blockerKeys(c);
  return c.tickets.filter(
    (t) => t.status !== 'done' && (keys.has(t.key) || (t.blocksExternal?.length ?? 0) > 0),
  );
}

export function childrenOf(c: Constellation, key: string): Ticket[] {
  return c.tickets.filter((t) => t.parent === key);
}

/** Tickets that are blocked by `key`. */
export function blocking(c: Constellation, key: string): Ticket[] {
  return allTickets(c).filter((t) => t.blockedBy.includes(key));
}
