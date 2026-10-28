// Theme: the only place colours, type, and pace durations live (VIDEO-PIPELINE.md §1, §8, §11.3).
export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const color = {
  bg: '#070b18',
  bgTop: '#101a35',
  grid: 'rgba(148, 163, 184, 0.07)',
  ink: '#e8edf7',
  muted: '#8a97b3',
  // Concept colours: one meaning each, for the whole video.
  broker: '#4f8cff', // Broker = blue
  brokerDeep: '#1d3d8f',
  producer: '#a78bfa', // Producer = violet
  consumer: '#cbd5e1', // healthy consumer = neutral
  amber: '#ffb547', // in flight / awaiting ack
  red: '#ff4d5e', // failure
  green: '#34d399', // success / ack
  codeBg: '#0d1326',
} as const;

// One typeface pair: Avenir Next for display/body, Menlo for code (macOS system fonts in the prototype).
export const font = {
  sans: '"Avenir Next", "Helvetica Neue", Arial, sans-serif',
  mono: 'Menlo, "SF Mono", monospace',
} as const;

// pace tokens -> ms (§8)
export const paceMs = { quick: 300, normal: 700, slow: 1200 } as const;
export type Pace = keyof typeof paceMs;

export const holdMs = { none: 0, short: 600, long: 1500 } as const;
export type Hold = keyof typeof holdMs;

export const timing = {
  openingMs: 300,
  padInMs: 120,
  padOutMs: 260,
  leadFrames: 4,
} as const;

// World anchors (world space = 1920x1080 before the camera transform).
export const anchor = {
  producer: { x: 380, y: 560 },
  broker: { x: 960, y: 560 },
  consumer: { x: 1540, y: 560 },
} as const;
