/**
 * Turns a constellation into positioned stars in world space (sun at 0,0).
 *
 * It is a radial tidy tree, not a scatter: every subtree owns an angular wedge
 * sized by how much work hangs off it, and its descendants are placed strictly
 * inside that wedge. Two consequences matter for readability —
 *  - parent→child lines from different subtrees can never cross, because the
 *    subtrees never share sky;
 *  - siblings are ordered so dependency chains are angular neighbours, which
 *    turns dependencies into short arcs along the ring instead of long chords.
 *
 * Positions are seeded off ticket keys, so a star sits in the same place every
 * time you open the app — the map becomes something you can learn.
 */
import { rngFor } from '../lib/rng';
import type { Constellation, Level, Ticket } from '../model/types';

export const SUN_RADIUS = 46;

/** Star radius as a fraction of the sun, per the spec: 30%, 20%, then 14%. */
const RADIUS_RATIO: Record<Level, number> = { 0: 1, 1: 0.3, 2: 0.2, 3: 0.14 };

/** Radial distance from a star to its children. */
const RING_GAP: Record<Level, number> = { 0: 0, 1: 300, 2: 200, 3: 125 };

/** World-space arc each leaf needs so its label has room. */
const ARC_PER_LEAF = 86;

export interface StarNode {
  ticket: Ticket;
  key: string;
  level: Level;
  x: number;
  y: number;
  r: number;
  parent: StarNode | null;
  children: StarNode[];
  /** How many tickets are waiting on this one. Drives the "blocking" look. */
  blocks: number;
  /** Distance and angle from the sun. */
  dist: number;
  angle: number;
  /** Angular wedge owned by this star's subtree, in radians. */
  wedge: number;
  /** Deterministic per-star phase so twinkling looks uncorrelated. */
  phase: number;
}

export type LinkKind = 'child' | 'depends';

export interface LinkEdge {
  from: StarNode;
  to: StarNode;
  kind: LinkKind;
}

export interface Layout {
  nodes: StarNode[];
  byKey: Map<string, StarNode>;
  links: LinkEdge[];
  /** Radius of the circle enclosing every star, for camera fitting. */
  extent: number;
}

/**
 * Order siblings so that dependency chains are angular neighbours: connected
 * groups first (largest first), each in blocker → blocked order.
 */
function orderSiblings(kids: Ticket[]): Ticket[] {
  if (kids.length < 3) return kids;
  const idx = new Map(kids.map((k, i) => [k.key, i]));
  const uf = kids.map((_, i) => i);
  const find = (a: number): number => (uf[a] === a ? a : (uf[a] = find(uf[a])));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) uf[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  kids.forEach((k, i) => {
    for (const b of k.blockedBy) {
      const j = idx.get(b);
      if (j !== undefined) union(i, j);
    }
  });

  const groups = new Map<number, number[]>();
  kids.forEach((_, i) => {
    const root = find(i);
    const list = groups.get(root);
    if (list) list.push(i);
    else groups.set(root, [i]);
  });

  const ordered: Ticket[] = [];
  const bySize = [...groups.values()].sort((a, b) => b.length - a.length || a[0] - b[0]);
  for (const group of bySize) {
    const inGroup = new Set(group);
    const indegree = new Map(group.map((i) => [i, 0]));
    for (const i of group) {
      for (const b of kids[i].blockedBy) {
        const j = idx.get(b);
        if (j !== undefined && inGroup.has(j)) indegree.set(i, (indegree.get(i) ?? 0) + 1);
      }
    }
    const queue = group.filter((i) => (indegree.get(i) ?? 0) === 0);
    const placed = new Set<number>();
    while (queue.length) {
      const i = queue.shift()!;
      if (placed.has(i)) continue;
      placed.add(i);
      ordered.push(kids[i]);
      for (const j of group) {
        if (placed.has(j)) continue;
        if (!kids[j].blockedBy.some((b) => idx.get(b) === i)) continue;
        const left = (indegree.get(j) ?? 1) - 1;
        indegree.set(j, left);
        if (left <= 0) queue.push(j);
      }
    }
    // Anything left is part of a cycle; keep it adjacent to its group anyway.
    for (const i of group) if (!placed.has(i)) ordered.push(kids[i]);
  }
  return ordered;
}

export function layoutConstellation(c: Constellation): Layout {
  const byKey = new Map<string, StarNode>();
  const nodes: StarNode[] = [];

  const childTickets = new Map<string, Ticket[]>();
  for (const t of c.tickets) {
    const list = childTickets.get(t.parent ?? '') ?? [];
    list.push(t);
    childTickets.set(t.parent ?? '', list);
  }

  /** Leaves under a ticket — the share of sky its subtree deserves. */
  const weights = new Map<string, number>();
  const weightOf = (key: string): number => {
    const cached = weights.get(key);
    if (cached !== undefined) return cached;
    const kids = childTickets.get(key) ?? [];
    const w = kids.length ? kids.reduce((sum, k) => sum + weightOf(k.key), 0) : 1;
    weights.set(key, w);
    return w;
  };
  const totalLeaves = weightOf(c.epic.key);

  // Push the first ring out far enough that the *outermost* ring still has
  // ARC_PER_LEAF of arc for every leaf. Two tiers per wedge buy back half of it.
  const deepestGap = RING_GAP[2] + RING_GAP[3];
  const ring1 = Math.max(
    260,
    Math.min(1500, (totalLeaves * ARC_PER_LEAF * 0.62) / (Math.PI * 2) - deepestGap * 0.5),
  );

  const addNode = (ticket: Ticket, parent: StarNode | null): StarNode => {
    const node: StarNode = {
      ticket,
      key: ticket.key,
      level: ticket.level,
      x: 0,
      y: 0,
      r: SUN_RADIUS * RADIUS_RATIO[ticket.level],
      parent,
      children: [],
      blocks: 0,
      dist: 0,
      angle: 0,
      wedge: Math.PI * 2,
      phase: rngFor(ticket.key)() * Math.PI * 2,
    };
    byKey.set(ticket.key, node);
    nodes.push(node);
    parent?.children.push(node);
    return node;
  };

  const sun = addNode(c.epic, null);

  /**
   * Hand each child a slice of the parent's wedge, proportional to its subtree,
   * and alternate the ring it sits on so neighbours are never shoulder to
   * shoulder at the same radius.
   */
  const place = (parentNode: StarNode, centre: number, wedge: number, radius: number) => {
    const kids = orderSiblings(childTickets.get(parentNode.key) ?? []);
    if (!kids.length) return;
    const level = (parentNode.level + 1) as Level;
    const gap = level === 1 ? ring1 : RING_GAP[level];
    const total = kids.reduce((sum, k) => sum + weightOf(k.key), 0);
    // Leave a margin so adjacent subtrees keep a visible gutter between them.
    const usable = wedge * (level === 1 ? 1 : 0.86);
    let cursor = centre - usable / 2;

    kids.forEach((ticket, i) => {
      const share = (usable * weightOf(ticket.key)) / total;
      const node = addNode(ticket, parentNode);
      const jitter = rngFor(`${ticket.key}:pos`);
      const slotCentre = cursor + share / 2;
      cursor += share;

      // Alternating tiers: even children sit on the inner ring, odd ones a step
      // further out, which doubles the room available for labels.
      const tier = kids.length > 2 ? (i % 2) * 0.24 : 0;
      const dist = radius + gap * (1 + tier + (jitter() - 0.5) * 0.07);
      const angle = slotCentre + (jitter() - 0.5) * share * 0.12;
      node.x = Math.cos(angle) * dist;
      node.y = Math.sin(angle) * dist;
      node.angle = angle;
      node.dist = dist;
      node.wedge = share;
      place(node, angle, share, dist);
    });
  };

  const start = rngFor(`${c.id}:start`)() * Math.PI * 2;
  place(sun, start, Math.PI * 2, 0);

  const links: LinkEdge[] = [];
  for (const n of nodes) {
    if (n.parent) links.push({ from: n.parent, to: n, kind: 'child' });
    for (const blocker of n.ticket.blockedBy) {
      const from = byKey.get(blocker);
      if (!from) continue;
      from.blocks += 1;
      links.push({ from, to: n, kind: 'depends' });
    }
  }

  const extent = nodes.reduce((max, n) => Math.max(max, n.dist + n.r), SUN_RADIUS);
  return { nodes, byKey, links, extent };
}
