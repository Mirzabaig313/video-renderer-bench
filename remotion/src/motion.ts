// Motion recipes: each is a pure function (timeline, frame) -> state. Components only draw.
import { Easing, interpolate, random } from 'remotion';
import { anchor, HEIGHT, WIDTH } from './theme';
import type { Timeline } from './timeline';

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const inOut = Easing.bezier(0.65, 0, 0.35, 1); // smooth in-out cubic, no overshoot
const out = Easing.bezier(0.16, 1, 0.3, 1); // expo-like out: fast exit, slow landing

/** Eased progress of a cue (0 before, 1 after). `dur` overrides the pace duration. */
export function cueP(tl: Timeline, id: string, frame: number, opts: { dur?: number; delay?: number; ease?: 'out' | 'inOut' } = {}): number {
  const c = tl.cues[id];
  if (!c) throw new Error(`unknown cue ${id}`);
  const t = clamp01((frame - c.frame - (opts.delay ?? 0)) / (opts.dur ?? c.frames));
  return (opts.ease === 'inOut' ? inOut : out)(t);
}

export const cueF = (tl: Timeline, id: string): number => {
  const c = tl.cues[id];
  if (!c) throw new Error(`unknown cue ${id}`);
  return c.frame;
};

export const ramp = (frame: number, from: number, dur: number, ease: 'out' | 'inOut' = 'out') =>
  (ease === 'out' ? out : inOut)(clamp01((frame - from) / dur));

// ---------- camera (zoomAndOpen / codeHighlight / redeliver / recap) ----------
export type Camera = { scale: number; cx: number; cy: number; shakeX: number; shakeY: number };

export function camera(tl: Timeline, frame: number): Camera {
  let s = { scale: 1, cx: WIDTH / 2, cy: HEIGHT / 2 + 10 };
  const go = (to: typeof s, t: number) => {
    s = { scale: lerp(s.scale, to.scale, t), cx: lerp(s.cx, to.cx, t), cy: lerp(s.cy, to.cy, t) };
  };
  // Slow drift during the opening so no beat is static.
  go({ scale: 1.035, cx: WIDTH / 2, cy: HEIGHT / 2 + 10 }, ramp(frame, cueF(tl, 'stream'), 120, 'inOut'));
  go({ scale: 2.15, cx: anchor.broker.x, cy: anchor.broker.y + 10 }, cueP(tl, 'zoom', frame, { dur: 42, ease: 'inOut' }));
  go({ scale: 1.35, cx: anchor.broker.x + 450 / 1.35, cy: anchor.broker.y + 10 }, cueP(tl, 'split', frame, { dur: 36, ease: 'inOut' }));
  go({ scale: 1.42, cx: anchor.broker.x + 450 / 1.42, cy: anchor.broker.y + 10 }, ramp(frame, cueF(tl, 'split') + 36, 100, 'inOut'));
  go({ scale: 1, cx: WIDTH / 2, cy: HEIGHT / 2 + 10 }, cueP(tl, 'pullback', frame, { dur: 40, ease: 'inOut' }));
  go({ scale: 1.06, cx: WIDTH / 2, cy: HEIGHT / 2 - 30 }, ramp(frame, cueF(tl, 'title_lost'), 150, 'inOut'));

  // Ambient drift (a slow 1–2% breathe) so no beat is ever a dead hold.
  s = { scale: s.scale * (1 + 0.012 * Math.sin(frame / 55)), cx: s.cx + 7 * Math.sin(frame / 80), cy: s.cy + 4 * Math.cos(frame / 67) };

  // Crash shake: seeded, decaying, frame-pure.
  const since = frame - cueF(tl, 'crash');
  const amp = since >= 0 && since < 18 ? 14 * (1 - since / 18) : 0;
  return {
    ...s,
    shakeX: amp * (random(`sx${frame}`) * 2 - 1),
    shakeY: amp * (random(`sy${frame}`) * 2 - 1),
  };
}

export const cameraTransform = (c: Camera) =>
  `translate(${WIDTH / 2 + c.shakeX} ${HEIGHT / 2 + c.shakeY}) scale(${c.scale}) translate(${-c.cx} ${-c.cy})`;

// ---------- crash (seeded shards) ----------
export type Shard = { x: number; y: number; rot: number; size: number; opacity: number; hue: string; pts: string };

export function crashShards(tl: Timeline, frame: number): Shard[] {
  const t0 = cueF(tl, 'crash');
  const t = frame - t0;
  if (t < 0 || t > 60) return [];
  const shards: Shard[] = [];
  for (let i = 0; i < 46; i++) {
    const a = random(`a${i}`) * Math.PI * 2;
    const v = 6 + random(`v${i}`) * 16;
    const spin = (random(`r${i}`) - 0.5) * 24;
    const size = 6 + random(`s${i}`) * 18;
    const drag = 1 - Math.exp(-t / 14); // fast burst that settles
    const x = anchor.consumer.x + Math.cos(a) * v * 14 * drag;
    const y = anchor.consumer.y + Math.sin(a) * v * 14 * drag + 0.06 * t * t;
    const k = random(`k${i}`);
    const pts = `0,${-size} ${size * (0.5 + k * 0.5)},${size * 0.6} ${-size * 0.7},${size * (0.2 + k * 0.4)}`;
    shards.push({ x, y, rot: spin * t, size, opacity: interpolate(t, [0, 40, 60], [1, 0.7, 0]), hue: k > 0.45 ? '#ff4d5e' : '#ffd0d5', pts });
  }
  return shards;
}

// ---------- ambient seeded dust ----------
export function dust(frame: number, n = 70) {
  return Array.from({ length: n }, (_, i) => {
    const x0 = random(`dx${i}`) * WIDTH;
    const y0 = random(`dy${i}`) * HEIGHT;
    const sp = 0.15 + random(`ds${i}`) * 0.5;
    const r = 0.8 + random(`dr${i}`) * 2.2;
    const x = (x0 + frame * sp * 0.6) % WIDTH;
    const y = (y0 - frame * sp + HEIGHT * 4) % HEIGHT;
    const tw = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(frame / (12 + i % 9) + i));
    return { x, y, r, o: tw * (0.3 + random(`do${i}`) * 0.7) };
  });
}
