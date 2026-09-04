import type { Layout, StarNode } from './layout';

export interface Camera {
  /** World coordinate at the centre of the viewport. */
  x: number;
  y: number;
  scale: number;
}

export const MIN_SCALE = 0.12;
export const MAX_SCALE = 4;

export function worldToScreen(cam: Camera, w: number, h: number, wx: number, wy: number) {
  return { x: (wx - cam.x) * cam.scale + w / 2, y: (wy - cam.y) * cam.scale + h / 2 };
}

export function screenToWorld(cam: Camera, w: number, h: number, sx: number, sy: number) {
  return { x: (sx - w / 2) / cam.scale + cam.x, y: (sy - h / 2) / cam.scale + cam.y };
}

export function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Camera that frames the whole constellation with a margin. */
export function fitCamera(extent: number, w: number, h: number, margin = 90): Camera {
  const scale = clampScale(Math.min((w - margin * 2) / (extent * 2), (h - margin * 2) / (extent * 2)));
  return { x: 0, y: 0, scale };
}

/** Camera centred on one star, at a readable zoom. */
export function focusCamera(node: StarNode, scale = 1.15): Camera {
  return { x: node.x, y: node.y, scale: clampScale(scale) };
}

export function hitTest(
  layout: Layout,
  cam: Camera,
  w: number,
  h: number,
  sx: number,
  sy: number,
): StarNode | null {
  let best: StarNode | null = null;
  let bestDist = Infinity;
  for (const node of layout.nodes) {
    const p = worldToScreen(cam, w, h, node.x, node.y);
    // Generous target: small stars stay clickable when zoomed out.
    const radius = Math.max(node.r * cam.scale, 11) + 4;
    const d = Math.hypot(p.x - sx, p.y - sy);
    if (d <= radius && d < bestDist) {
      best = node;
      bestDist = d;
    }
  }
  return best;
}
