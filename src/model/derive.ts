/**
 * Only leaves carry a status of their own — those are the tickets somebody
 * actually moves on a board. Everything above them is a summary of what hangs
 * off it, so an epic can never claim to be done while a sub-task underneath it
 * is still open.
 *
 * Applied at load time, so it holds for the dummy source and for Jira later:
 * the Jira adapter only has to map leaf statuses correctly.
 */
import type { Constellation, Galaxy, Status, Ticket } from './types';

function rollUp(children: Status[]): Status {
  if (children.every((s) => s === 'done')) return 'done';
  if (children.some((s) => s === 'in_progress' || s === 'done')) return 'in_progress';
  if (children.some((s) => s === 'blocked')) return 'blocked';
  return 'todo';
}

export function deriveStatuses(c: Constellation): Constellation {
  const childrenOf = new Map<string, Ticket[]>();
  for (const t of c.tickets) {
    const list = childrenOf.get(t.parent ?? '') ?? [];
    list.push(t);
    childrenOf.set(t.parent ?? '', list);
  }

  const resolved = new Map<string, Status>();
  const statusOf = (t: Ticket): Status => {
    const cached = resolved.get(t.key);
    if (cached) return cached;
    const kids = childrenOf.get(t.key) ?? [];
    const status = kids.length ? rollUp(kids.map(statusOf)) : t.status;
    resolved.set(t.key, status);
    return status;
  };

  const epic = { ...c.epic, status: statusOf(c.epic) };
  const tickets = c.tickets.map((t) => ({ ...t, status: statusOf(t) }));
  return { ...c, epic, tickets };
}

export function deriveGalaxy(g: Galaxy): Galaxy {
  return { ...g, constellations: g.constellations.map(deriveStatuses) };
}
