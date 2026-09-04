import { useEffect, useRef } from 'react';
import type { Camera } from '../engine/camera';
import { clampScale, fitCamera, focusCamera, hitTest, screenToWorld } from '../engine/camera';
import type { Layout } from '../engine/layout';
import { renderConstellation, type RenderState } from '../engine/renderer';

export interface CameraRequest {
  kind: 'fit' | 'focus';
  key?: string;
  /** Bump to re-trigger the same request. */
  nonce: number;
}

interface Props {
  layout: Layout;
  progress: number;
  complete?: boolean;
  selected?: string | null;
  matched?: Set<string> | null;
  labelMode?: RenderState['labelMode'];
  interactive?: boolean;
  cameraRequest?: CameraRequest;
  onSelect?: (key: string | null) => void;
  onHover?: (key: string | null) => void;
  className?: string;
}

/** Everything the hovered/selected star is related to, for the dimming pass. */
function focusSet(layout: Layout, key: string | null): Set<string> | null {
  if (!key) return null;
  const node = layout.byKey.get(key);
  if (!node) return null;
  const set = new Set<string>([node.key]);
  if (node.parent) set.add(node.parent.key);
  for (const c of node.children) set.add(c.key);
  for (const b of node.ticket.blockedBy) set.add(b);
  for (const link of layout.links) {
    if (link.kind === 'depends' && link.from.key === node.key) set.add(link.to.key);
  }
  return set;
}

export function ConstellationCanvas({
  layout,
  progress,
  complete = false,
  selected = null,
  matched = null,
  labelMode = 'auto',
  interactive = true,
  cameraRequest,
  onSelect,
  onHover,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const camRef = useRef<Camera>({ x: 0, y: 0, scale: 0.5 });
  const targetRef = useRef<Camera | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const sizeRef = useRef({ w: 1, h: 1 });

  // Mutable mirrors of the props the render loop needs, so the loop never
  // depends on React's render cycle.
  const stateRef = useRef({ layout, progress, complete, selected, matched, labelMode });
  stateRef.current = { layout, progress, complete, selected, matched, labelMode };
  const focusRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    focusRef.current = focusSet(layout, selected ?? hoveredRef.current);
  }, [layout, selected]);

  // --- sizing -------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement!;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      const prev = sizeRef.current;
      sizeRef.current = { w, h };
      // First measurement (or a resize while framed) refits the view.
      if (prev.w <= 1) camRef.current = fitCamera(layout.extent, w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [layout]);

  // Refit when the constellation changes.
  useEffect(() => {
    const { w, h } = sizeRef.current;
    targetRef.current = fitCamera(layout.extent, w, h);
  }, [layout]);

  useEffect(() => {
    if (!cameraRequest) return;
    const { w, h } = sizeRef.current;
    if (cameraRequest.kind === 'fit') {
      targetRef.current = fitCamera(layout.extent, w, h);
    } else if (cameraRequest.key) {
      const node = layout.byKey.get(cameraRequest.key);
      if (node) targetRef.current = focusCamera(node, node.level === 0 ? 0.8 : 1.25);
    }
  }, [cameraRequest, layout]);

  // --- render loop --------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;
    const start = performance.now();

    const frame = (now: number) => {
      const { w, h } = sizeRef.current;
      const cam = camRef.current;
      const target = targetRef.current;
      if (target) {
        // Ease toward the requested camera; snap and clear when close enough.
        cam.x += (target.x - cam.x) * 0.16;
        cam.y += (target.y - cam.y) * 0.16;
        cam.scale += (target.scale - cam.scale) * 0.16;
        if (
          Math.abs(target.x - cam.x) < 0.6 &&
          Math.abs(target.y - cam.y) < 0.6 &&
          Math.abs(target.scale - cam.scale) < 0.002
        ) {
          camRef.current = { ...target };
          targetRef.current = null;
        }
      }
      const s = stateRef.current;
      const st: RenderState = {
        camera: camRef.current,
        time: (now - start) / 1000,
        hovered: hoveredRef.current,
        selected: s.selected,
        matched: s.matched,
        focus: focusRef.current,
        progress: s.progress,
        complete: s.complete,
        labelMode: s.labelMode,
      };
      renderConstellation(ctx, w, h, s.layout, st);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // --- interaction --------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !interactive) return;

    let dragging = false;
    let moved = 0;
    let last = { x: 0, y: 0 };

    const local = (e: PointerEvent | WheelEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { w, h } = sizeRef.current;
      const cam = camRef.current;
      const p = local(e);
      const before = screenToWorld(cam, w, h, p.x, p.y);
      const factor = Math.exp(-e.deltaY * 0.0016);
      const scale = clampScale(cam.scale * factor);
      const after = screenToWorld({ ...cam, scale }, w, h, p.x, p.y);
      // Keep the world point under the cursor pinned while zooming.
      camRef.current = { x: cam.x + (before.x - after.x), y: cam.y + (before.y - after.y), scale };
      targetRef.current = null;
    };

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      moved = 0;
      last = local(e);
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
      targetRef.current = null;
    };

    const onPointerMove = (e: PointerEvent) => {
      const p = local(e);
      const { w, h } = sizeRef.current;
      if (dragging) {
        const cam = camRef.current;
        const dx = (p.x - last.x) / cam.scale;
        const dy = (p.y - last.y) / cam.scale;
        moved += Math.abs(p.x - last.x) + Math.abs(p.y - last.y);
        camRef.current = { ...cam, x: cam.x - dx, y: cam.y - dy };
        last = p;
        return;
      }
      const hit = hitTest(stateRef.current.layout, camRef.current, w, h, p.x, p.y);
      const key = hit?.key ?? null;
      if (key !== hoveredRef.current) {
        hoveredRef.current = key;
        canvas.style.cursor = key ? 'pointer' : 'grab';
        if (!stateRef.current.selected) {
          focusRef.current = focusSet(stateRef.current.layout, key);
        }
        onHover?.(key);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      canvas.releasePointerCapture(e.pointerId);
      canvas.style.cursor = hoveredRef.current ? 'pointer' : 'grab';
      if (moved > 6) return; // a drag, not a click
      const p = local(e);
      const { w, h } = sizeRef.current;
      const hit = hitTest(stateRef.current.layout, camRef.current, w, h, p.x, p.y);
      onSelect?.(hit?.key ?? null);
    };

    const onDoubleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const { w, h } = sizeRef.current;
      const hit = hitTest(
        stateRef.current.layout,
        camRef.current,
        w,
        h,
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
      if (hit) targetRef.current = focusCamera(hit, hit.level === 0 ? 0.8 : 1.3);
    };

    const onLeave = () => {
      if (hoveredRef.current) {
        hoveredRef.current = null;
        if (!stateRef.current.selected) focusRef.current = null;
        onHover?.(null);
      }
    };

    canvas.style.cursor = 'grab';
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('dblclick', onDoubleClick);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('dblclick', onDoubleClick);
    };
  }, [interactive, onSelect, onHover]);

  return <canvas ref={canvasRef} className={className} />;
}
