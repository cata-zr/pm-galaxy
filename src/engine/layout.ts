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

export interface Point {
  x: number;
  y: number;
}

export interface Layout {
  nodes: StarNode[];
  byKey: Map<string, StarNode>;
  links: LinkEdge[];
  /** Radius of the circle enclosing every star, for camera fitting. */
  extent: number;
  /**
   * Flat constellations only: the wobbled outer silhouette the stars were laid
   * along, in world space, for the background glow. `closed` is false for open
   * shapes (the spiral), which glow as a band rather than a filled region.
   */
  outline?: { points: Point[]; closed: boolean };
  /** This galaxy's own sun silhouette, so no two suns look stamped out. */
  sunShape: SunShape;
}

/** One lobe of the sun's limb: a sine of `k` bumps that drifts at `speed`. */
export interface SunHarmonic {
  k: number;
  amp: number;
  phase: number;
  speed: number;
}

export interface SunShape {
  /** Slight oval: x is stretched by `squash`, y shrunk by it, then tilted. */
  squash: number;
  tilt: number;
  harmonics: SunHarmonic[];
}

/**
 * A seeded, roundish sun per galaxy. Deliberately subtle: a few percent of
 * size, oval and lumpiness, enough that suns read as individuals side by side.
 */
function sunShapeFor(id: string): { shape: SunShape; size: number } {
  const rand = rngFor(`${id}:sun`);
  const size = 0.9 + rand() * 0.22;
  const squash = 1 + rand() * 0.08;
  const tilt = rand() * Math.PI;
  const ks = [2, 3, 4, 5, 6];
  for (let i = ks.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ks[i], ks[j]] = [ks[j], ks[i]];
  }
  ks.length = 3 + Math.floor(rand() * 2);
  const harmonics = ks.map((k) => ({
    k,
    amp: (0.018 + rand() * 0.04) / Math.sqrt(k / 2),
    phase: rand() * Math.PI * 2,
    speed: (rand() < 0.5 ? -1 : 1) * (0.4 + rand() * 1),
  }));
  return { shape: { squash, tilt, harmonics }, size };
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

// ---------------------------------------------------------------------------
// Flat constellations
// ---------------------------------------------------------------------------

/**
 * Silhouettes for flat constellations (every ticket sits directly under the
 * epic). A tidy tree of one level is just an evenly spaced ring, so every flat
 * project looked the same; laying the stars along a recognisable outline gives
 * each one a face. Each shape maps t ∈ [0, 1] to a point of roughly unit size
 * around the sun at the origin.
 */
interface Shape {
  name: string;
  closed: boolean;
  /** Largest seeded rotation either way. Shapes with an up side barely tilt. */
  tilt: number;
  at: (t: number) => Point;
}

const polar = (r: number, a: number): Point => ({ x: Math.cos(a) * r, y: Math.sin(a) * r });

const SHAPES: Shape[] = [
  { name: 'ellipse', closed: true, tilt: Math.PI, at: (t) => {
    const a = t * Math.PI * 2;
    return { x: Math.cos(a) * 1.25, y: Math.sin(a) * 0.78 };
  } },
  // Four wings, pinched at the body; the upper pair is the larger.
  { name: 'butterfly', closed: true, tilt: 0.3, at: (t) => {
    const a = t * Math.PI * 2;
    const wing = Math.pow(Math.abs(Math.sin(2 * a)), 0.7) * (Math.sin(a) < 0 ? 1 : 0.74);
    return polar(0.42 + 0.68 * wing, a);
  } },
  { name: 'heart', closed: true, tilt: 0.3, at: (t) => {
    const a = t * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(a), 3);
    const y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
    return { x: x / 15, y: y / 15 + 0.12 };
  } },
  { name: 'star', closed: true, tilt: Math.PI, at: (t) => {
    const a = t * Math.PI * 2;
    return polar(0.5 + 0.55 * Math.pow((Math.cos(5 * a) + 1) / 2, 1.4), a);
  } },
  // Open curve: about a turn and a half, starting clear of the sun.
  { name: 'spiral', closed: false, tilt: Math.PI, at: (t) => polar(0.55 + 0.7 * t, 0.5 + t * Math.PI * 2.9) },
  { name: 'trefoil', closed: true, tilt: Math.PI, at: (t) => {
    const a = t * Math.PI * 2;
    return polar(0.45 + 0.6 * Math.abs(Math.cos(1.5 * a)), a);
  } },
];

/** World-space arc each star on an outline gets, so labels have room. */
const FLAT_ARC_PER_STAR = 112;
/** Smallest outline scale, so a handful of stars still reads as a shape. */
const FLAT_MIN_SCALE = 280;
/** No star sits closer than this to the sun's centre, so none lands under the epic's title. */
const FLAT_MIN_SUN_DIST = 215;
/** Pairs closer than this are pushed apart by the relaxation pass. */
const FLAT_MIN_GAP = 78;
/** A star nearer the sun keeps at least this far off a farther star's spoke. */
const FLAT_SPOKE_CLEAR = 36;
/** From this many stars on, a second smaller copy of the outline is nested inside. */
const FLAT_NEST_FROM = 14;
const FLAT_INNER_SCALE = 0.55;
const OUTLINE_SAMPLES = 480;

/** Densely sampled outline with cumulative arc length, for even spacing. */
interface Polyline {
  points: Point[];
  cumulative: number[];
  length: number;
  closed: boolean;
}

function toPolyline(points: Point[], closed: boolean): Polyline {
  const cumulative = [0];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    cumulative.push(cumulative[i] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return { points, cumulative, length: cumulative[cumulative.length - 1], closed };
}

/** Point and unit normal at arc length `s` along the polyline. */
function pointAtArc(line: Polyline, s: number): { p: Point; nx: number; ny: number } {
  const { points, cumulative, length } = line;
  s = line.closed ? ((s % length) + length) % length : Math.min(Math.max(s, 0), length);
  let lo = 0;
  let hi = cumulative.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] <= s) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[(lo + 1) % points.length];
  const seg = cumulative[lo + 1] - cumulative[lo] || 1;
  const f = (s - cumulative[lo]) / seg;
  const dx = (b.x - a.x) / seg;
  const dy = (b.y - a.y) / seg;
  return { p: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, nx: -dy, ny: dx };
}

/**
 * Positions for `count` stars along the galaxy's silhouette. The outline is
 * deliberately loose: its radius wobbles, the gaps between stars vary, and each
 * star is nudged off the line, so it reads as a shape without looking drawn.
 */
function flatPositions(c: Constellation, index: number, count: number) {
  const shape = SHAPES[index % SHAPES.length];
  const rand = rngFor(`${c.id}:shape`);
  const rotation = (rand() * 2 - 1) * shape.tilt;
  const stretch = 0.9 + rand() * 0.2;
  const waves = [2, 3, 5].map((k, i) => ({ k, phase: rand() * Math.PI * 2, amp: [0.05, 0.035, 0.02][i] }));

  const unit: Point[] = [];
  const samples = shape.closed ? OUTLINE_SAMPLES : OUTLINE_SAMPLES + 1;
  for (let i = 0; i < samples; i++) {
    const raw = shape.at(i / OUTLINE_SAMPLES);
    const x = raw.x * stretch;
    const y = raw.y / stretch;
    const theta = Math.atan2(y, x);
    const wobble = 1 + waves.reduce((sum, w) => sum + w.amp * Math.sin(w.k * theta + w.phase), 0);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    unit.push({ x: (x * cos - y * sin) * wobble, y: (x * sin + y * cos) * wobble });
  }
  const unitLength = toPolyline(unit, shape.closed).length;

  // Large galaxies stay compact by nesting a smaller copy of the outline rather
  // than growing the whole shape, which cropped the thumbnails.
  const nested = count >= FLAT_NEST_FROM;
  const outerCount = nested ? Math.round(count / (1 + FLAT_INNER_SCALE)) : count;
  const scale = Math.max(FLAT_MIN_SCALE, (outerCount * FLAT_ARC_PER_STAR) / unitLength);

  const ring = (factor: number) =>
    toPolyline(unit.map((p) => ({ x: p.x * scale * factor, y: p.y * scale * factor })), shape.closed);
  const outer = ring(1);
  const rings: { line: Polyline; count: number }[] = [{ line: outer, count: outerCount }];
  if (nested) rings.push({ line: ring(FLAT_INNER_SCALE), count: count - outerCount });

  const positions: Point[] = [];
  const offset = rand();
  rings.forEach(({ line, count: n }, r) => {
    const spacing = line.length / n;
    // The inner ring is offset half a slot so its stars sit between the outer ones.
    const start = (offset + r * 0.5 / n) * (line.closed ? line.length : 0);
    for (let i = 0; i < n; i++) {
      const s = start + (i + 0.5 + (rand() - 0.5) * 0.45) * spacing;
      const { p, nx, ny } = pointAtArc(line, s);
      const nudge = (rand() - 0.5) * Math.min(spacing, FLAT_ARC_PER_STAR) * 0.32;
      positions.push({ x: p.x + nx * nudge, y: p.y + ny * nudge });
    }
  });

  relax(positions, rand);
  return { positions, outline: { points: outer.points, closed: shape.closed } };
}

/**
 * With a nested ring, an inner star can land on the line from the sun to an
 * outer one, so the spoke runs through it. Slide the two apart sideways: the
 * nearer star one way, the farther the other, which swings the spoke clear.
 */
function clearSpoke(a: Point, b: Point): boolean {
  const [near, far] = Math.hypot(a.x, a.y) < Math.hypot(b.x, b.y) ? [a, b] : [b, a];
  const len2 = far.x * far.x + far.y * far.y;
  const t = (near.x * far.x + near.y * far.y) / len2;
  if (t <= 0 || t >= 1) return false;
  const len = Math.sqrt(len2);
  // Signed distance of the nearer star from the spoke, and the spoke's normal.
  const nx = -far.y / len;
  const ny = far.x / len;
  const side = near.x * nx + near.y * ny;
  const off = Math.abs(side);
  if (off >= FLAT_SPOKE_CLEAR) return false;
  const dir = side < 0 ? -1 : 1;
  const push = (FLAT_SPOKE_CLEAR - off) / 2;
  near.x += nx * dir * push;
  near.y += ny * dir * push;
  far.x -= nx * dir * push;
  far.y -= ny * dir * push;
  return true;
}

/** Push apart any pair that is still too close, and keep everyone off the sun. */
function relax(positions: Point[], rand: () => number) {
  for (let iter = 0; iter < 80; iter++) {
    let moved = false;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i];
        const b = positions[j];
        if (clearSpoke(a, b)) moved = true;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= FLAT_MIN_GAP) continue;
        if (d < 1e-3) {
          const ang = rand() * Math.PI * 2;
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          d = 1;
        }
        const push = (FLAT_MIN_GAP - d) / 2 / d;
        a.x -= dx * push;
        a.y -= dy * push;
        b.x += dx * push;
        b.y += dy * push;
        moved = true;
      }
    }
    // Only the stars that crowd the sun move outward; the shape keeps its size.
    for (const p of positions) {
      const d = Math.hypot(p.x, p.y);
      if (d >= FLAT_MIN_SUN_DIST) continue;
      const k = FLAT_MIN_SUN_DIST / (d || 1);
      p.x = d ? p.x * k : FLAT_MIN_SUN_DIST;
      p.y *= d ? k : 0;
      moved = true;
    }
    if (!moved) break;
  }
}

export function layoutConstellation(c: Constellation, index = 0): Layout {
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
  const { shape: sunShape, size: sunSize } = sunShapeFor(c.id);
  sun.r *= sunSize;

  /**
   * Hand each child a slice of the parent's wedge, proportional to its subtree,
   * and alternate the ring it sits on so neighbours are never shoulder to
   * shoulder at the same radius.
   */
  const place = (parentNode: StarNode, centre: number, wedge: number, radius: number) => {
    const kids = orderSiblings(childTickets.get(parentNode.key) ?? []);
    if (!kids.length) return;
    // Clamped, because a real Jira hierarchy can be deeper than the four levels
    // the model has sizes for: the source caps `Ticket.level` at 3, so a level-3
    // parent may have level-3 children. Without the clamp this reads
    // RING_GAP[4] === undefined, every distance below becomes NaN, and the NaN
    // propagates into `extent` and blanks the whole canvas.
    const level = Math.min(parentNode.level + 1, 3) as Level;
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

  const flat = c.tickets.length > 0 && c.tickets.every((t) => t.parent === c.epic.key);
  let outline: Layout['outline'];
  if (flat) {
    // Sibling order still matters: dependency chains stay neighbours along the outline.
    const kids = orderSiblings(c.tickets);
    const shaped = flatPositions(c, index, kids.length);
    outline = shaped.outline;
    kids.forEach((ticket, i) => {
      const node = addNode(ticket, sun);
      const { x, y } = shaped.positions[i];
      node.x = x;
      node.y = y;
      node.dist = Math.hypot(x, y);
      node.angle = Math.atan2(y, x);
      node.wedge = (Math.PI * 2) / kids.length;
    });
  } else {
    const start = rngFor(`${c.id}:start`)() * Math.PI * 2;
    place(sun, start, Math.PI * 2, 0);
  }

  const links: LinkEdge[] = [];
  for (const n of nodes) {
    if (n.parent) links.push({ from: n.parent, to: n, kind: 'child' });
    // Dependents in another constellation have no node to draw an arc to, but
    // they are still work waiting on this ticket, so they count towards red.
    n.blocks += n.ticket.blocksExternal?.length ?? 0;
    for (const blocker of n.ticket.blockedBy) {
      const from = byKey.get(blocker);
      if (!from) continue;
      from.blocks += 1;
      links.push({ from, to: n, kind: 'depends' });
    }
  }

  const extent = nodes.reduce((max, n) => Math.max(max, n.dist + n.r), SUN_RADIUS);
  return { nodes, byKey, links, extent, outline, sunShape };
}
