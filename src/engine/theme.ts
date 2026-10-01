/**
 * The visual language.
 *
 * A star's light is its progress; its colour is its effect on everyone else.
 * Red never means "this ticket is stuck" — it means "other work is waiting on
 * this one", which is the thing worth spotting from across the room.
 */

/** What a star looks like, derived from its status *and* what depends on it. */
export type Visual = 'unlit' | 'igniting' | 'blocking' | 'blocking_active' | 'lit';

export interface StarPalette {
  /** Core colour of the star body. */
  core: string;
  /** Colour of the surrounding glow. */
  glow: string;
  /** 0 = dead rock, 1 = fully lit. */
  intensity: number;
  /**
   * Multiplier on the halo's radius (1 = default). The second channel after
   * brightness: blockers are tight, intense points that demand attention, done
   * stars are softer but spread a broad halo. Keep the spread modest — a
   * finished cluster has to stay readable.
   */
  glowSize?: number;
  /** Multiplier on the halo's opacity (1 = default). */
  glowAlpha?: number;
  /** Amplitude of the brightness pulse, in intensity units. */
  pulse: number;
  /** Pulse speed multiplier. */
  pulseRate: number;
  /**
   * Optional second colour the star cycles towards on the same wave as the
   * brightness pulse, so the pulse carries a *direction* rather than just
   * blinking. Only `blocking_active` uses it today.
   */
  pulseTo?: { core: string; glow: string };
  /**
   * Exponent shaping how the colour mix rides the wave. 1 = linear, which
   * splits the cycle evenly between the two colours — and because the pulse
   * brightens on the way towards `pulseTo`, an even split lets the second
   * colour dominate: it always arrives at full brightness while the base colour
   * only ever shows at the dim end. Raising this holds the star on its base
   * colour and turns `pulseTo` into a brief flash at the crest.
   * Higher = more of the base colour.
   */
  pulseSkew?: number;
}

/** Linear mix of two `#rrggbb` colours. `t` is clamped to 0..1. */
export function mixHex(a: string, b: string, t: number): string {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const ai = parseInt(a.slice(1), 16);
  const bi = parseInt(b.slice(1), 16);
  const mix = (shift: number) => {
    const av = (ai >> shift) & 255;
    const bv = (bi >> shift) & 255;
    return Math.round(av + (bv - av) * k);
  };
  return `rgb(${mix(16)}, ${mix(8)}, ${mix(0)})`;
}

export const STAR_PALETTE: Record<Visual, StarPalette> = {
  // Not started, and nobody is waiting on it: a cold body lit only by the sun.
  unlit: { core: '#525d7d', glow: '#8ea2cc', intensity: 0.1, pulse: 0.02, pulseRate: 0.4 },
  // Under way: a cool blue flicker. Tight glow — it is not the thing to look at.
  igniting: {
    core: '#cdefff',
    glow: '#4fb4ff',
    intensity: 0.66,
    pulse: 0.16,
    pulseRate: 2.1,
    glowSize: 0.8,
    glowAlpha: 0.7,
  },
  // Something is waiting on this and it has not started. The brightest thing on
  // the map after the sun: blockers are the project's pain and should be found
  // from across the room. Intense but tight — brightness, not bloom.
  blocking: {
    core: '#ffa998',
    glow: '#ff4a3f',
    intensity: 0.88,
    pulse: 0.03,
    pulseRate: 0.5,
    glowSize: 0.95,
    glowAlpha: 0.85,
  },
  // Waiting on this, but it is moving. It breathes red → amber and back: amber
  // is already "blocker in progress" on the dependency arcs, so the star is
  // saying it is on its way out of red. Deliberately *not* the done gold —
  // that colour is the reward and must not appear on unfinished work.
  // Rate is ~2.6s per breath: slow enough to read as breathing, fast enough that
  // you cannot glance at the map and miss it. It was 0.85 and got missed.
  blocking_active: {
    core: '#ffbfae',
    glow: '#ff5544',
    intensity: 0.88,
    pulse: 0.18,
    pulseRate: 3,
    glowSize: 1,
    glowAlpha: 0.9,
    pulseTo: { core: '#ffdca8', glow: '#ffb030' },
    // Red is the state; amber is only the hint that it is moving. Amber is the
    // more luminous colour and lands on the bright half of the pulse, so it has
    // to be held back or it takes the star over. Turn this down for more amber.
    pulseSkew: 4,
  },
  // Done. Deliberately dimmer at the core than the blockers — finished work is
  // not what needs attention — but it carries the widest, softest halo, so a
  // lit cluster still reads as warmth filling the constellation. The halo is
  // where the glare risk lives: widen it further only after checking a fully
  // done constellation (`vault-rotation`).
  lit: {
    core: '#fff6dc',
    glow: '#ffc85c',
    intensity: 0.7,
    pulse: 0.04,
    pulseRate: 0.8,
    glowSize: 1.3,
    glowAlpha: 1,
  },
};

export const LINK_STYLE = {
  /** Parent → child. Structural: quiet, but always legible. */
  childLit: 'rgba(214, 234, 255, 0.78)',
  childDim: 'rgba(158, 184, 232, 0.46)',
  /** Dependency lines take the colour of the blocker's progress. */
  dependsOpen: 'rgba(255, 76, 62, 0.85)',
  dependsActive: 'rgba(255, 176, 48, 0.85)',
  dependsClear: 'rgba(74, 222, 150, 0.8)',
};

/**
 * A blocked leaf gets a slowly turning belt of debris instead of a colour.
 *
 * A ticket's own "I am stuck" state had nowhere to go: `visualOf` only reads
 * done / blocks / in_progress, so a blocked leaf that nothing depends on
 * rendered as plain `unlit` — indistinguishable from work nobody had touched.
 * The belt is a *third* channel, orthogonal to the two the stars already use
 * (brightness ranks attention, halo spread carries state), so it adds the
 * signal without touching STAR_PALETTE at all.
 *
 * Deliberately **grey, not red.** Red is reserved for "other work is waiting on
 * this one" (principle 1), and a red belt around a red `blocking` star — the
 * most important ticket type on the map — would merge into one red blob and
 * cost both readings. Grey debris leaves the hue channel alone and still reads
 * against the near-black background. Real asteroid belts are grey anyway.
 */
export const BELT = {
  /**
   * Belt radius as a multiple of the star radius. It has to clear the star's
   * halo or it gets washed out: `blocking`'s reaches ~3.2r at full brightness,
   * `unlit`'s only 2.4r, so one constant sits outside both.
   */
  radius: 3.4,
  /**
   * Vertical squash. A true circle reads as a loading spinner — "the app is
   * fetching" — which is the wrong message entirely. An inclined ellipse reads
   * as an orbital plane.
   */
  squash: 0.35,
  /** Chunks of debris around the belt. A constant *count* at any zoom, so the
   *  dashes scale with the star instead of with the screen. Kept fine-grained:
   *  at 14 the chunks grew large enough when zoomed in to read as a dashed
   *  selection outline rather than as rubble. */
  chunks: 24,
  /** Fraction of each chunk's slot that is solid rock rather than gap. */
  duty: 0.38,
  /** Seconds per revolution. Slow on purpose, for the same reason as `squash`:
   *  slow reads orbital, fast reads spinner. It is also a rhythm nothing else
   *  on the map uses — the star pulse is ~2.1s and the dependency dashes flow
   *  faster than that. */
  period: 12,
  /** Cool grey-white. Kept dimmer than the unlit star's rim (0.75 alpha) so the
   *  belt never outshines the body it orbits. */
  colour: '#c2cde8',
  alpha: 0.5,
  /** Stroke width is `r * 0.16`, capped here. Without the cap a zoomed-in belt
   *  turns into a heavy dashed ring that competes with the star. */
  maxLineWidth: 2.4,
  /**
   * Below this on-screen belt radius the dashes degenerate into shimmer, so the
   * belt is skipped entirely. Gating on *screen* radius rather than camera
   * scale means it adapts per star level — and it keeps belts out of the galaxy
   * map's miniatures for free, which would otherwise be five cards of
   * sub-pixel noise.
   */
  minScreenRadius: 9,
};

export const UI = {
  bg: '#010207',
  nebulaA: 'rgba(48, 38, 104, 0.16)',
  nebulaB: 'rgba(12, 54, 92, 0.14)',
  nebulaC: 'rgba(96, 26, 78, 0.1)',
  label: 'rgba(226, 234, 255, 0.92)',
  labelDim: 'rgba(200, 212, 242, 0.72)',
  accent: '#ffc247',
};
