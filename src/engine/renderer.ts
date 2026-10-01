/**
 * Canvas renderer for one constellation. Pure draw code: it reads a Layout plus
 * a RenderState and paints a frame. No React, no DOM lookups, no mutation of
 * the layout — which keeps the 60fps path cheap and the UI code boring.
 */
import { hash, mulberry32 } from '../lib/rng';
import type { Camera } from './camera';
import { worldToScreen } from './camera';
import type { Layout, LinkEdge, StarNode, SunShape } from './layout';
import { BELT, LINK_STYLE, STAR_PALETTE, UI, mixHex, type StarPalette, type Visual } from './theme';

/**
 * A star's look, from its own progress plus whether anything waits on it.
 * Red is reserved for blockers: done work is lit whatever it used to hold up.
 */
export function visualOf(node: StarNode): Visual {
  const status = node.ticket.status;
  if (status === 'done') return 'lit';
  if (node.blocks > 0) return status === 'in_progress' ? 'blocking_active' : 'blocking';
  if (status === 'in_progress') return 'igniting';
  return 'unlit';
}

export interface RenderState {
  camera: Camera;
  /** Seconds since load — drives twinkle, pulse and dependency flow. */
  time: number;
  hovered: string | null;
  selected: string | null;
  /** Keys matching the current search, or null when the search box is empty. */
  matched: Set<string> | null;
  /** Keys in the focus set (hovered/selected star and its relations). */
  focus: Set<string> | null;
  /** 0..1 completion of the epic — how warm the banked fire is. */
  progress: number;
  /** Every ticket done: the sun ignites and floods the constellation. */
  complete: boolean;
  labelMode: 'auto' | 'all' | 'minimal';
}

const BG_STAR_COUNT = 900;

interface BgStar {
  x: number;
  y: number;
  r: number;
  a: number;
  phase: number;
}

let bgStars: BgStar[] | null = null;

function backgroundStars(): BgStar[] {
  if (bgStars) return bgStars;
  const rand = mulberry32(0xc0ffee);
  bgStars = Array.from({ length: BG_STAR_COUNT }, () => ({
    x: (rand() - 0.5) * 6000,
    y: (rand() - 0.5) * 6000,
    r: 0.35 + rand() * 1.15,
    a: 0.18 + rand() * 0.62,
    phase: rand() * Math.PI * 2,
  }));
  return bgStars;
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, st: RenderState) {
  ctx.fillStyle = UI.bg;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const drift = (fx: number) => ({
    x: w / 2 - st.camera.x * st.camera.scale * fx,
    y: h / 2 - st.camera.y * st.camera.scale * fx,
  });
  const clouds: [string, number, number, number, number][] = [
    [UI.nebulaA, 0.08, -0.35, -0.28, 0.95],
    [UI.nebulaB, 0.12, 0.4, 0.22, 0.8],
    [UI.nebulaC, 0.06, 0.15, -0.42, 0.62],
  ];
  for (const [color, parallax, ox, oy, size] of clouds) {
    const c = drift(parallax);
    const cx = c.x + ox * w;
    const cy = c.y + oy * h;
    const radius = Math.max(w, h) * size;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // Distant field, parallaxed so panning feels like moving through space.
  const p = 0.35;
  const cam = st.camera;
  for (const s of backgroundStars()) {
    const x = (s.x - cam.x * p) * cam.scale + w / 2;
    const y = (s.y - cam.y * p) * cam.scale + h / 2;
    if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue;
    const twinkle = 0.75 + 0.25 * Math.sin(st.time * 1.4 + s.phase);
    ctx.globalAlpha = s.a * twinkle;
    ctx.fillStyle = '#dfe8ff';
    ctx.beginPath();
    ctx.arc(x, y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Silhouette glow (flat constellations)
// ---------------------------------------------------------------------------

/** How far, in world units, the glow fades out past the silhouette's edge. */
const SHAPE_GLOW_FADE = 150;
const SHAPE_GLOW_LAYERS = 18;
const SHAPE_GLOW_LAYER_ALPHA = 0.05;
const SHAPE_GLOW_COLOUR = '150, 165, 255';
const SHAPE_GLOW_ALPHA = 0.1;

interface GlowSprite {
  canvas: HTMLCanvasElement;
  /** World-space top-left corner and world units per sprite pixel. */
  x: number;
  y: number;
  unit: number;
}

const glowCache = new WeakMap<Layout, GlowSprite>();

/**
 * Painted once per layout into an offscreen canvas, then blitted every frame:
 * a flat interior plus stacked round strokes that thin out away from the edge,
 * so the glow fades outward without a per-frame blur.
 */
function glowSprite(layout: Layout): GlowSprite | null {
  const outline = layout.outline;
  if (!outline) return null;
  const cached = glowCache.get(layout);
  if (cached) return cached;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of outline.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  minX -= SHAPE_GLOW_FADE;
  minY -= SHAPE_GLOW_FADE;
  maxX += SHAPE_GLOW_FADE;
  maxY += SHAPE_GLOW_FADE;
  // It is a soft glow, so half a pixel per world unit is plenty.
  const unit = Math.max(2, Math.max(maxX - minX, maxY - minY) / 1024);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((maxX - minX) / unit);
  canvas.height = Math.ceil((maxY - minY) / unit);
  const g = canvas.getContext('2d');
  if (!g) return null;

  g.scale(1 / unit, 1 / unit);
  g.translate(-minX, -minY);
  g.beginPath();
  outline.points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  if (outline.closed) g.closePath();

  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = `rgba(${SHAPE_GLOW_COLOUR}, ${SHAPE_GLOW_LAYER_ALPHA})`;
  for (let k = SHAPE_GLOW_LAYERS; k >= 1; k--) {
    g.lineWidth = (2 * SHAPE_GLOW_FADE * k) / SHAPE_GLOW_LAYERS;
    g.stroke();
  }
  if (outline.closed) {
    // Replace the inside with the level the strokes reach on the line itself,
    // so the edge has no bright rim: the glow is flat inside and fades outside.
    const peak = 1 - Math.pow(1 - SHAPE_GLOW_LAYER_ALPHA, SHAPE_GLOW_LAYERS);
    g.save();
    g.clip();
    g.clearRect(minX, minY, maxX - minX, maxY - minY);
    g.fillStyle = `rgba(${SHAPE_GLOW_COLOUR}, ${peak})`;
    g.fill();
    g.restore();
  }

  const sprite = { canvas, x: minX, y: minY, unit };
  glowCache.set(layout, sprite);
  return sprite;
}

function drawShapeGlow(ctx: CanvasRenderingContext2D, w: number, h: number, layout: Layout, st: RenderState) {
  // A finished constellation has its flare instead; the glow would muddy it.
  if (st.complete) return;
  const sprite = glowSprite(layout);
  if (!sprite) return;
  const cam = st.camera;
  const p = worldToScreen(cam, w, h, sprite.x, sprite.y);
  const k = sprite.unit * cam.scale;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = SHAPE_GLOW_ALPHA;
  ctx.drawImage(sprite.canvas, p.x, p.y, sprite.canvas.width * k, sprite.canvas.height * k);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/**
 * Dependency edges follow the ring they live on instead of cutting a chord
 * across the system: the curve is pushed out to just beyond the average orbit
 * of its two endpoints. Because siblings are laid out with dependency chains
 * adjacent, that turns most dependencies into short arcs that trace the orbit.
 *
 * `spacing` (0..1, stable per edge) lifts each arc to its own radius, so two
 * dependencies over the same stretch of sky do not lie on top of each other.
 */
function dependsControlPoint(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  sunX: number,
  sunY: number,
  spacing: number,
  scale: number,
) {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  let ux = mx - sunX;
  let uy = my - sunY;
  const rm = Math.hypot(ux, uy);
  const chord = Math.hypot(bx - ax, by - ay);
  if (rm < 1) {
    // Degenerate: the midpoint sits on the sun. Fall back to a perpendicular bow.
    const len = chord || 1;
    return { x: mx - ((by - ay) / len) * 40, y: my + ((bx - ax) / len) * 40 };
  }
  ux /= rm;
  uy /= rm;
  const ra = Math.hypot(ax - sunX, ay - sunY);
  const rb = Math.hypot(bx - sunX, by - sunY);
  // Clear the orbit, plus a per-edge lane, plus a little more for long arcs.
  const lift =
    (14 + spacing * 26) * Math.max(scale, 0.4) + Math.min(chord * 0.12, 46 * Math.max(scale, 0.4));
  const targetR = (ra + rb) / 2 + lift;
  // Quadratic midpoint is (A + 2·CP + B)/4, so aim CP at twice the offset.
  return { x: 2 * (sunX + ux * targetR) - mx, y: 2 * (sunY + uy * targetR) - my };
}

/** Pull a segment endpoint back to the edge of its star. */
function trim(x: number, y: number, towardX: number, towardY: number, by: number) {
  const dx = towardX - x;
  const dy = towardY - y;
  const d = Math.hypot(dx, dy) || 1;
  if (d <= by) return { x, y };
  return { x: x + (dx / d) * by, y: y + (dy / d) * by };
}

const laneCache = new Map<string, number>();

/** Stable 0..1 lane for an edge, so overlapping arcs get their own radius. */
function laneOf(link: LinkEdge): number {
  const id = `${link.from.key}>${link.to.key}`;
  let lane = laneCache.get(id);
  if (lane === undefined) {
    lane = (hash(id) % 1000) / 1000;
    laneCache.set(id, lane);
  }
  return lane;
}

function edgeAlpha(st: RenderState, link: LinkEdge): number {
  if (!st.focus) return 1;
  const on = st.focus.has(link.from.key) && st.focus.has(link.to.key);
  return on ? 1 : 0.14;
}

function drawLinks(ctx: CanvasRenderingContext2D, w: number, h: number, layout: Layout, st: RenderState) {
  const cam = st.camera;
  const sun = worldToScreen(cam, w, h, 0, 0);
  ctx.save();
  ctx.lineCap = 'round';

  // Structure first, dependencies on top: blockers are what you came to see.
  for (const pass of ['child', 'depends'] as const) {
    for (const link of layout.links) {
      if (link.kind !== pass) continue;
      const a = worldToScreen(cam, w, h, link.from.x, link.from.y);
      const b = worldToScreen(cam, w, h, link.to.x, link.to.y);
      if (
        Math.max(a.x, b.x) < -50 ||
        Math.min(a.x, b.x) > w + 50 ||
        Math.max(a.y, b.y) < -50 ||
        Math.min(a.y, b.y) > h + 50
      ) {
        continue;
      }
      const alpha = edgeAlpha(st, link);
      ctx.globalAlpha = alpha;
      const rFrom = Math.max(link.from.r * cam.scale, link.from.level === 0 ? 8 : 3);
      const rTo = Math.max(link.to.r * cam.scale, 3);

      if (pass === 'child') {
        const bothLit = link.from.ticket.status === 'done' && link.to.ticket.status === 'done';
        ctx.strokeStyle = bothLit ? LINK_STYLE.childLit : LINK_STYLE.childDim;
        ctx.setLineDash([]);
        ctx.lineWidth = Math.max(1.1, (link.to.level === 1 ? 2 : 1.4) * cam.scale);
        if (bothLit) {
          ctx.shadowColor = 'rgba(255, 214, 140, 0.5)';
          ctx.shadowBlur = 8 * cam.scale;
        }
        // Stop at the star's edge so the line never runs under a body.
        const s = trim(a.x, a.y, b.x, b.y, rFrom + 2);
        const e = trim(b.x, b.y, a.x, a.y, rTo + 2);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(e.x, e.y);
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else {
        // The path takes the colour of the blocker: red while it has not
        // started, amber while it is moving, green once the way is clear.
        const blocker = link.from.ticket.status;
        const satisfied = blocker === 'done';
        ctx.strokeStyle = satisfied
          ? LINK_STYLE.dependsClear
          : blocker === 'in_progress'
            ? LINK_STYLE.dependsActive
            : LINK_STYLE.dependsOpen;
        ctx.lineWidth = Math.max(0.9, 1.5 * cam.scale);
        const dash = 7 * Math.max(cam.scale, 0.35);
        ctx.setLineDash([dash, dash * 1.6]);
        // Dashes flow blocker → blocked, so the direction is readable.
        const flow = satisfied ? 42 : blocker === 'in_progress' ? 26 : 14;
        ctx.lineDashOffset = -st.time * flow * Math.max(cam.scale, 0.4);
        const lane = laneOf(link);
        const cp = dependsControlPoint(a.x, a.y, b.x, b.y, sun.x, sun.y, lane, cam.scale);
        const s = trim(a.x, a.y, cp.x, cp.y, rFrom + 3);
        const e = trim(b.x, b.y, cp.x, cp.y, rTo + 4);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.quadraticCurveTo(cp.x, cp.y, e.x, e.y);
        ctx.stroke();
        ctx.setLineDash([]);
        if (alpha > 0.5 && cam.scale > 0.35) {
          drawArrowHead(ctx, cp.x, cp.y, e.x, e.y, ctx.strokeStyle as string, cam.scale);
        }
      }
    }
  }
  ctx.restore();
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  x: number,
  y: number,
  color: string,
  scale: number,
) {
  const ang = Math.atan2(y - fromY, x - fromX);
  const size = Math.max(5, 8 * scale);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-size * 1.6, -size * 0.55);
  ctx.lineTo(0, 0);
  ctx.lineTo(-size * 1.6, size * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Stars
// ---------------------------------------------------------------------------

/** The star's pulse, as 0..1. Brightness and colour ride this same wave. */
function pulseWave(p: StarPalette, time: number, phase: number): number {
  return (Math.sin(time * p.pulseRate + phase) + 1) / 2;
}

function brightness(p: StarPalette, wave: number): number {
  return Math.max(0, p.intensity + (wave * 2 - 1) * p.pulse);
}

function drawGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha: number,
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, color);
  g.addColorStop(0.35, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSpikes(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  len: number,
  color: string,
  alpha: number,
  rotation: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  const g = ctx.createLinearGradient(-len, 0, len, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.5, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  for (const rot of [0, Math.PI / 2]) {
    ctx.save();
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(-len, 0);
    ctx.lineTo(0, -len * 0.06 - 0.8);
    ctx.lineTo(len, 0);
    ctx.lineTo(0, len * 0.06 + 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Wobbling flame outline. The lobes come from the galaxy's own `SunShape`, so
 * every sun has its own lumpy silhouette; they drift with time, and a fine
 * fixed ripple on top keeps the limb reading as flame.
 */
function flamePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  t: number,
  shape: SunShape,
) {
  ctx.beginPath();
  const steps = 72;
  const cos = Math.cos(shape.tilt);
  const sin = Math.sin(shape.tilt);
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    let wobble = 1 + 0.02 * Math.sin(a * 9 + t * 0.55);
    for (const hm of shape.harmonics) wobble += hm.amp * Math.sin(a * hm.k + hm.phase + t * hm.speed);
    const ox = Math.cos(a) * r * wobble * shape.squash;
    const oy = (Math.sin(a) * r * wobble) / shape.squash;
    const px = x + ox * cos - oy * sin;
    const py = y + ox * sin + oy * cos;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * 0 while the epic is unfinished, ramping to 1 shortly after a completed
 * constellation opens — the ignition is meant to be watched, not just noticed.
 */
function ignition(st: RenderState): number {
  if (!st.complete) return 0;
  const e = Math.min(1, Math.max(0, (st.time - 0.4) / 2.2));
  return e * e * (3 - 2 * e);
}

/**
 * Candy hues (degrees) the stars of a finished constellation cycle through:
 * strawberry, orange, lemon, lime, cyan, grape, hot pink.
 */
const CANDY_HUES = [345, 24, 54, 115, 190, 268, 315];

/** Fully saturated HSL → RGB; `l` is 0..1. */
function hueToRgb(h: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return [f(0), f(8), f(4)];
}

/**
 * A star's current candy colour: a smooth cross-fade through a seeded random
 * sequence of `CANDY_HUES`, at the star's own pace and phase. It blends the
 * hue, not RGB, so the in-between colours stay as vivid as the stops instead
 * of going muddy (orange → green through olive).
 */
function candyColour(node: StarNode, time: number): [number, number, number] {
  const rate = 0.07 + ((hash(`${node.key}:candy-rate`) % 1000) / 1000) * 0.1;
  const pos = time * rate + node.phase;
  const step = Math.floor(pos);
  const at = (k: number) => CANDY_HUES[hash(`${node.key}:${k}`) % CANDY_HUES.length];
  const a = at(step);
  // Shortest way round the colour wheel.
  const delta = ((at(step + 1) - a + 540) % 360) - 180;
  const f = pos - step;
  const e = f * f * (3 - 2 * f);
  return hueToRgb((a + delta * e + 360) % 360, 0.55);
}

/** Seconds between drum strikes, and how long a ring takes to reach the edge. */
const PULSE_INTERVAL = 2.8;
const PULSE_DURATION = 1;

/**
 * One glowing ring: soft bands that are brightest on the ring's line and fade
 * to nothing on both sides, a wide warm halo under a narrower white-hot one.
 * Gradients rather than stacked strokes, so a thick ring glows instead of
 * reading as a flat stripe.
 */
function drawPulseRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  width: number,
  glowAlpha: number,
  coreAlpha: number,
) {
  const bands: [number, number, string][] = [
    [width * 2.2, 0.4 * glowAlpha, '255, 190, 110'],
    [width * 0.85, 0.95 * coreAlpha, '255, 248, 228'],
  ];
  for (const [half, a, rgb] of bands) {
    if (a < 0.005) continue;
    const inner = Math.max(0, radius - half);
    const outer = radius + half;
    const g = ctx.createRadialGradient(x, y, inner, x, y, outer);
    const mid = (radius - inner) / (outer - inner);
    g.addColorStop(0, `rgba(${rgb}, 0)`);
    g.addColorStop(mid, `rgba(${rgb}, ${a})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, outer, 0, Math.PI * 2);
    ctx.arc(x, y, inner, 0, Math.PI * 2, true);
    ctx.fill();
  }
}

/**
 * The payoff for finishing an epic: the sun floods the constellation with
 * white light and beats like a slow drum, each strike sending a glowing
 * shockwave racing out past the furthest star, thinning as it widens.
 */
function drawSunlight(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  layout: Layout,
  st: RenderState,
) {
  const ign = ignition(st);
  if (ign <= 0.001) return;
  const cam = st.camera;
  const sun = worldToScreen(cam, w, h, 0, 0);
  const sunR = Math.max((layout.nodes[0]?.r ?? 46) * cam.scale, 8);
  const extentPx = layout.extent * cam.scale;
  const t = st.time;
  const breathe = 0.94 + 0.06 * Math.sin(t * 0.55);
  const R = Math.max(extentPx * 1.3, 200) * breathe;

  drawGlow(ctx, sun.x, sun.y, R, 'rgba(255, 214, 170, 1)', 0.13 * ign);
  drawGlow(ctx, sun.x, sun.y, R * 0.5, 'rgba(255, 244, 226, 1)', 0.08 * ign);

  const reach = Math.max(extentPx * 1.9, sunR * 9);
  // Starts as a thick band about the sun's own size, wasting away as it spreads.
  const startWidth = Math.max(12, sunR * 1.4);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // Seconds since the ignition began (see `ignition`); strikes start then.
  const since = t - 0.4;
  const newest = Math.floor(since / PULSE_INTERVAL);
  const span = Math.ceil(PULSE_DURATION / PULSE_INTERVAL);
  for (let k = newest; k >= Math.max(0, newest - span); k--) {
    const age = since - k * PULSE_INTERVAL;
    if (age < 0 || age > PULSE_DURATION) continue;
    const p = age / PULSE_DURATION;
    // A strike: very fast off the sun, decelerating as it spreads.
    const e = 1 - Math.pow(1 - p, 3);
    const radius = sunR + e * (reach - sunR);
    const width = Math.max(1, startWidth * Math.pow(1 - p, 1.5));
    // The white-hot core burns out well before its glow does.
    const glow = ign * Math.pow(1 - p, 0.8);
    const core = ign * Math.pow(1 - p, 2.6);
    drawPulseRing(ctx, sun.x, sun.y, radius, width, glow, core);
  }
  ctx.restore();
}

function drawSun(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  st: RenderState,
  emphasis: number,
  shape: SunShape,
) {
  const ign = ignition(st);
  // Before ignition the sun is a banked fire: it warms as the epic fills in,
  // but it does not *light* until every star is lit.
  const warm = 0.2 + st.progress * 0.45;
  const t = st.time;
  const flicker = 1 + 0.02 * Math.sin(t * 3.1) + 0.014 * Math.sin(t * 1.73 + 1.2);

  const coronaR = r * (1.9 + warm * 0.8 + ign * 2.6) * flicker;
  drawGlow(ctx, x, y, coronaR, `rgba(255, 122, 26, ${0.1 + warm * 0.1 + ign * 0.3})`, emphasis);
  drawGlow(ctx, x, y, r * (1.35 + ign * 0.9) * flicker, `rgba(255, 198, 104, ${0.12 + warm * 0.12 + ign * 0.45})`, emphasis);
  if (ign > 0) {
    // Ignited, the sun goes white-hot: the brightest thing in the sky.
    drawGlow(ctx, x, y, r * 2.4 * flicker, 'rgba(255, 252, 240, 1)', 0.55 * ign * emphasis);
    drawGlow(ctx, x, y, r * 1.35 * flicker, 'rgba(255, 255, 255, 1)', 0.6 * ign * emphasis);
  }

  ctx.save();
  ctx.globalAlpha = emphasis;

  // Body: embers before ignition, white-hot after.
  flamePath(ctx, x, y, r * flicker * (1 + ign * 0.06), t, shape);
  const mix = (dark: number[], hot: number[]) =>
    `rgb(${dark.map((c, i) => Math.round(c + (hot[i] - c) * ign)).join(',')})`;
  const body = ctx.createRadialGradient(x, y, r * 0.05, x, y, r * 1.06);
  body.addColorStop(0, mix([170, 92, 38], [255, 252, 236]));
  body.addColorStop(0.32, mix([138, 62, 22], [255, 246, 214]));
  body.addColorStop(0.66, mix([96, 36, 12], [255, 214, 132]));
  body.addColorStop(1, mix([54, 18, 8], [246, 150, 60]));
  ctx.fillStyle = body;
  ctx.fill();

  // Churn: hot cells and cooler spots drifting across the surface, clipped to
  // the flame outline so the sun reads as boiling rather than as a disc.
  ctx.clip();
  const cells: [number, number, number, number][] = [
    [0.62, 0.31, 0.42, 0.0],
    [0.51, -0.44, 0.34, 1.9],
    [0.44, 0.63, 0.3, 3.4],
    [0.7, -0.24, 0.26, 5.1],
  ];
  ctx.globalCompositeOperation = 'lighter';
  for (const [dist, speed, size, phase] of cells) {
    const a = t * speed + phase;
    const cx = x + Math.cos(a) * r * dist * 0.7;
    const cy = y + Math.sin(a * 0.83 + phase) * r * dist * 0.7;
    const rad = r * size * (1 + 0.12 * Math.sin(t * 1.6 + phase));
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, `rgba(255, 226, 170, ${(0.12 + ign * 0.22) * emphasis})`);
    g.addColorStop(1, 'rgba(255, 180, 60, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r * 1.3, y - r * 1.3, r * 2.6, r * 2.6);
  }
  ctx.globalCompositeOperation = 'source-over';
  for (const [dist, speed, size, phase] of cells) {
    const a = -t * speed * 0.7 + phase * 1.7;
    const cx = x + Math.cos(a) * r * dist * 0.62;
    const cy = y + Math.sin(a * 1.21 + phase) * r * dist * 0.62;
    const rad = r * size * 0.75;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    // Sunspots fade as it ignites; on a white-hot body they read as smudges.
    g.addColorStop(0, `rgba(150, 44, 8, ${0.22 * (1 - ign * 0.85) * emphasis})`);
    g.addColorStop(1, 'rgba(150, 44, 8, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r * 1.3, y - r * 1.3, r * 2.6, r * 2.6);
  }
  ctx.restore();

  // A thin licking rim, redrawn on top so the silhouette stays crisp.
  ctx.save();
  ctx.globalAlpha = emphasis * (0.28 + warm * 0.2 + ign * 0.4);
  ctx.globalCompositeOperation = 'lighter';
  flamePath(ctx, x, y, r * flicker * 1.02, t + 0.6, shape);
  ctx.strokeStyle = 'rgba(255, 190, 96, 0.75)';
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.stroke();
  ctx.restore();
}

function drawStarBody(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  node: StarNode,
  st: RenderState,
  emphasis: number,
) {
  const visual = visualOf(node);
  const p = STAR_PALETTE[visual];
  const wave = pulseWave(p, st.time, node.phase);
  const b = brightness(p, wave);
  // A palette with `pulseTo` cycles colour on the same wave as its brightness,
  // shaped by `pulseSkew` so the base colour keeps most of the cycle.
  const tint = p.pulseTo ? Math.pow(wave, p.pulseSkew ?? 1) : 0;
  const coreColour = p.pulseTo ? mixHex(p.core, p.pulseTo.core, tint) : p.core;
  const glowColour = p.pulseTo ? mixHex(p.glow, p.pulseTo.glow, tint) : p.glow;
  // A finished constellation celebrates: every star burns in candy colours,
  // cross-fading in from its normal look as the sun ignites.
  const ign = ignition(st);
  if (ign >= 1) {
    drawCandyStar(ctx, x, y, r, node, st, b, emphasis);
    return;
  }
  if (ign > 0) drawCandyStar(ctx, x, y, r, node, st, b, emphasis * ign);
  emphasis *= 1 - ign;

  if (visual === 'unlit') {
    // Unlit: a cold body catching a little sunlight, plus a bright rim. It has to
    // be findable against near-black without ever looking like it is burning.
    drawGlow(ctx, x, y, r * 2.4, 'rgba(126, 152, 210, 1)', 0.14 * emphasis);
    ctx.save();
    ctx.globalAlpha = emphasis;
    const body = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    body.addColorStop(0, '#6c789c');
    body.addColorStop(1, '#2c3348');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(178, 196, 238, ${0.75 * emphasis})`;
    ctx.lineWidth = Math.max(1, r * 0.18);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Glow is kept tight: a cluster of finished stars should stay readable.
  drawGlow(
    ctx,
    x,
    y,
    r * (2.3 + b * 1.1) * (p.glowSize ?? 1),
    glowColour,
    b * 0.3 * (p.glowAlpha ?? 1) * emphasis,
  );
  if (visual === 'lit') {
    drawSpikes(ctx, x, y, r * 3, 'rgba(255, 238, 198, 0.45)', b * 0.28 * emphasis, 0.4);
  }
  const core = ctx.createRadialGradient(x, y, 0, x, y, r * 1.05);
  core.addColorStop(0, '#fffdf4');
  core.addColorStop(0.45, coreColour);
  core.addColorStop(1, glowColour);
  ctx.save();
  ctx.globalAlpha = Math.min(1, 0.5 + b * 0.4) * emphasis;
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * A celebrating star drawn as a light source, not a coloured disc: a white-hot
 * centre that only tints toward its rim, inside a strong additive glow in its
 * colour. Saturated colour on the body itself reads as paint; saturated
 * colour in the *light around* a white core reads as a burning star.
 */
function drawCandyStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  node: StarNode,
  st: RenderState,
  b: number,
  emphasis: number,
) {
  const [cr, cg, cb] = candyColour(node, st.time);
  const colour = `rgb(${cr}, ${cg}, ${cb})`;
  const tint = (k: number) =>
    `rgb(${Math.round(cr + (255 - cr) * k)}, ${Math.round(cg + (255 - cg) * k)}, ${Math.round(cb + (255 - cb) * k)})`;
  const flare = 0.85 + 0.15 * b;

  drawGlow(ctx, x, y, r * 4.2 * flare, colour, 0.32 * emphasis);
  drawGlow(ctx, x, y, r * 2.1 * flare, colour, 0.6 * emphasis);
  drawSpikes(ctx, x, y, r * 3.4, tint(0.5), 0.5 * flare * emphasis, 0.4);

  const core = ctx.createRadialGradient(x, y, 0, x, y, r * 1.1);
  core.addColorStop(0, '#ffffff');
  core.addColorStop(0.35, tint(0.75));
  core.addColorStop(0.75, tint(0.25));
  core.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = emphasis;
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Blocked belts
// ---------------------------------------------------------------------------

/**
 * One blocked leaf's belt: a single dashed ellipse whose dash offset advances,
 * so the dashes *are* the debris. Deliberately not a dozen particle arcs —
 * this is one path per blocked star, which keeps it off the 60fps budget, and
 * no `shadowBlur`, which is the expensive call in this file.
 */
function drawBelt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  node: StarNode,
  st: RenderState,
  emphasis: number,
) {
  const rx = r * BELT.radius;
  const ry = rx * BELT.squash;

  // Ramanujan's approximation. It only paces the dashes, so close enough.
  const perimeter = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  const slot = perimeter / BELT.chunks;

  ctx.save();
  ctx.globalAlpha = BELT.alpha * emphasis;
  ctx.strokeStyle = BELT.colour;
  ctx.lineWidth = Math.min(Math.max(0.8, r * 0.16), BELT.maxLineWidth);
  ctx.setLineDash([slot * BELT.duty, slot * (1 - BELT.duty)]);
  // The offset advances one whole perimeter per `period`, so the debris laps
  // the star once per period. Dashes are spaced by *arc length*, so on a
  // squashed ellipse they visibly quicken along the long edges and linger at
  // the ends — which is exactly what sells it as an orbit instead of a spin.
  ctx.lineDashOffset = -(st.time / BELT.period) * perimeter;
  ctx.beginPath();
  // Per-star tilt from the seeded phase: belts are not all parallel, and a
  // star keeps the same tilt on every reload (principle 8).
  ctx.ellipse(x, y, rx, ry, node.phase, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * Belts are drawn between the links and the stars — debris orbits *around* the
 * body, and the star's core has to stay the brightest thing on screen
 * (principle 2).
 *
 * **Leaves only.** A parent's status is a roll-up (`model/derive.ts`), so
 * belting parents would ring a whole subtree because one sub-task is stuck.
 */
function drawBelts(ctx: CanvasRenderingContext2D, w: number, h: number, layout: Layout, st: RenderState) {
  for (const node of layout.nodes) {
    if (node.level === 0 || node.children.length > 0) continue;
    if (node.ticket.status !== 'blocked') continue;

    // Gate on the *unfloored* radius: the 3px floor the stars use would keep
    // every belt above the threshold no matter how far you zoom out.
    const raw = node.r * st.camera.scale;
    if (raw * BELT.radius < BELT.minScreenRadius) continue;
    const r = Math.max(raw, 3);

    const p = worldToScreen(st.camera, w, h, node.x, node.y);
    const margin = r * BELT.radius + 40;
    if (p.x < -margin || p.y < -margin || p.x > w + margin || p.y > h + margin) continue;

    const dimmed = st.focus && !st.focus.has(node.key);
    drawBelt(ctx, p.x, p.y, r, node, st, dimmed ? 0.22 : 1);
  }
}

function drawSelectionRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  time: number,
  strong: boolean,
) {
  const ring = r + (strong ? 10 : 7) + Math.sin(time * 2.4) * 1.6;
  ctx.save();
  ctx.strokeStyle = strong ? 'rgba(255, 194, 71, 0.95)' : 'rgba(190, 216, 255, 0.6)';
  ctx.lineWidth = strong ? 2 : 1.2;
  ctx.setLineDash(strong ? [] : [4, 4]);
  ctx.beginPath();
  ctx.arc(x, y, ring, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

function labelFor(node: StarNode, st: RenderState): { text: string; size: number } | null {
  const scale = st.camera.scale;
  const isFocus = node.key === st.hovered || node.key === st.selected;
  // Minimal mode is used by the galaxy previews, where the card carries the name.
  if (st.labelMode === 'minimal' && !isFocus) return null;
  if (node.level === 0) return { text: node.ticket.key, size: 15 };
  // The layout reserves label room per level, so labels can simply stay on;
  // these thresholds only drop text that would be too small to read anyway.
  if (st.labelMode === 'auto' && !isFocus) {
    if (node.level >= 3 && scale < 0.75) return null;
    if (node.level === 2 && scale < 0.45) return null;
    if (node.level === 1 && scale < 0.22) return null;
  }
  const size = node.level === 1 ? 13 : node.level === 2 ? 11.5 : 10.5;
  return { text: node.ticket.key, size };
}

type Rect = [number, number, number, number];

function overlapArea(a: Rect, b: Rect): number {
  const ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const oy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

/** Candidate anchors around a star: eight compass points, outward preferred. */
const ANCHORS: { dx: number; dy: number; align: CanvasTextAlign }[] = [
  { dx: 1, dy: 0, align: 'left' },
  { dx: -1, dy: 0, align: 'right' },
  { dx: 0.72, dy: -0.72, align: 'left' },
  { dx: 0.72, dy: 0.72, align: 'left' },
  { dx: -0.72, dy: -0.72, align: 'right' },
  { dx: -0.72, dy: 0.72, align: 'right' },
  { dx: 0, dy: -1, align: 'center' },
  { dx: 0, dy: 1, align: 'center' },
];

interface Placed {
  node: StarNode;
  text: string;
  size: number;
  x: number;
  y: number;
  align: CanvasTextAlign;
  rect: Rect;
}

function rectFor(x: number, y: number, width: number, size: number, align: CanvasTextAlign): Rect {
  const left = align === 'left' ? x : align === 'right' ? x - width : x - width / 2;
  return [left - 3, y - size * 0.72, left + width + 3, y + size * 0.72];
}

/**
 * Place every label — none are dropped. Each star picks the compass point with
 * the least conflict against labels already placed and against other stars,
 * with a nudge toward the outward direction, where there is usually open sky.
 */
function planLabels(w: number, h: number, layout: Layout, st: RenderState, ctx: CanvasRenderingContext2D): Placed[] {
  const cam = st.camera;
  const placed: Placed[] = [];
  const taken: Rect[] = [];

  // Stars are obstacles too: a key sitting on top of another star is unreadable.
  const discs: Rect[] = [];
  const screen = new Map<StarNode, { x: number; y: number; r: number }>();
  for (const node of layout.nodes) {
    const p = worldToScreen(cam, w, h, node.x, node.y);
    const r = Math.max(node.r * cam.scale, node.level === 0 ? 8 : 3);
    screen.set(node, { x: p.x, y: p.y, r });
    if (p.x > -80 && p.y > -80 && p.x < w + 80 && p.y < h + 80) {
      discs.push([p.x - r - 2, p.y - r - 2, p.x + r + 2, p.y + r + 2]);
    }
  }

  // Sun first, then by level: the important keys claim their spot first.
  const ordered = [...layout.nodes].sort((a, b) => {
    const pa = a.key === st.selected || a.key === st.hovered ? -1 : a.level;
    const pb = b.key === st.selected || b.key === st.hovered ? -1 : b.level;
    return pa - pb;
  });

  for (const node of ordered) {
    const label = labelFor(node, st);
    if (!label) continue;
    const p = screen.get(node)!;
    if (p.x < -200 || p.y < -60 || p.x > w + 200 || p.y > h + 60) continue;

    ctx.font = labelFont(node, label.size, st);
    const width = ctx.measureText(label.text).width;
    const gap = p.r + 7;
    // Outward from the sun, in screen space.
    const sun = worldToScreen(cam, w, h, 0, 0);
    let ox = p.x - sun.x;
    let oy = p.y - sun.y;
    const olen = Math.hypot(ox, oy) || 1;
    ox /= olen;
    oy /= olen;

    let best: Placed | null = null;
    let bestCost = Infinity;
    for (const anchor of ANCHORS) {
      const x = p.x + anchor.dx * gap;
      const y = p.y + anchor.dy * gap + (anchor.dy === 0 ? 0.5 : anchor.dy * label.size * 0.55);
      const rect = rectFor(x, y, width, label.size, anchor.align);
      let cost = 0;
      for (const t of taken) cost += overlapArea(rect, t) * 3;
      for (const d of discs) cost += overlapArea(rect, d) * 2;
      // Prefer pointing away from the sun, then the horizontal anchors.
      cost += (1 - (anchor.dx * ox + anchor.dy * oy)) * 140;
      cost += anchor.align === 'center' ? 90 : 0;
      if (cost < bestCost) {
        bestCost = cost;
        best = { node, text: label.text, size: label.size, x, y, align: anchor.align, rect };
      }
      if (cost === 0) break;
    }
    if (!best) continue;
    placed.push(best);
    taken.push(best.rect);
  }
  return placed;
}

function labelFont(node: StarNode, size: number, st: RenderState): string {
  const strong = node.key === st.hovered || node.key === st.selected || st.matched?.has(node.key);
  return `${strong ? 600 : 400} ${size}px "SF Mono", ui-monospace, Menlo, monospace`;
}

function drawLabels(ctx: CanvasRenderingContext2D, w: number, h: number, layout: Layout, st: RenderState) {
  ctx.save();
  ctx.textBaseline = 'middle';

  for (const item of planLabels(w, h, layout, st, ctx)) {
    const node = item.node;
    const dimmed = st.focus && !st.focus.has(node.key);
    const matched = st.matched?.has(node.key);
    const isFocus = node.key === st.hovered || node.key === st.selected;

    ctx.textAlign = item.align;
    ctx.font = labelFont(node, item.size, st);
    ctx.globalAlpha = dimmed ? 0.25 : 1;
    ctx.fillStyle = matched ? UI.accent : isFocus ? '#ffffff' : node.level === 0 ? UI.label : UI.labelDim;
    ctx.shadowColor = 'rgba(0,0,0,0.95)';
    ctx.shadowBlur = 6;
    ctx.fillText(item.text, item.x, item.y);

    if (node.level === 0) {
      ctx.font = '600 20px Inter, system-ui, -apple-system, sans-serif';
      ctx.fillStyle = 'rgba(255,244,220,0.95)';
      ctx.fillText(node.ticket.title, item.x, item.y - 19);
    }
    ctx.shadowBlur = 0;
  }
  ctx.textAlign = 'left';
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

export function renderConstellation(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  layout: Layout,
  st: RenderState,
) {
  drawBackground(ctx, w, h, st);
  drawShapeGlow(ctx, w, h, layout, st);
  drawSunlight(ctx, w, h, layout, st);
  drawLinks(ctx, w, h, layout, st);
  drawBelts(ctx, w, h, layout, st);

  for (const node of layout.nodes) {
    const p = worldToScreen(st.camera, w, h, node.x, node.y);
    const r = Math.max(node.r * st.camera.scale, node.level === 0 ? 8 : 3);
    const margin = r * 6 + 40;
    if (p.x < -margin || p.y < -margin || p.x > w + margin || p.y > h + margin) continue;

    const dimmed = st.focus && !st.focus.has(node.key);
    const emphasis = dimmed ? 0.22 : 1;

    if (node.level === 0) drawSun(ctx, p.x, p.y, r, st, emphasis, layout.sunShape);
    else drawStarBody(ctx, p.x, p.y, r, node, st, emphasis);

    if (st.matched?.has(node.key)) {
      drawSelectionRing(ctx, p.x, p.y, r + 3, st.time, false);
    }
    if (node.key === st.selected) drawSelectionRing(ctx, p.x, p.y, r, st.time, true);
    else if (node.key === st.hovered) drawSelectionRing(ctx, p.x, p.y, r, st.time, false);
  }

  drawLabels(ctx, w, h, layout, st);
}
