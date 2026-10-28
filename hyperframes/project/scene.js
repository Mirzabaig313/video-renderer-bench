// Recipe library for the HyperFrames composition (hand-written, static; never generated).
// Reads window.__PLAN (written by translate.mjs from the storyboard) and builds the picture in two
// deterministic layers, both pure functions of timeline time (no Date.now, Math.random, rAF):
//   1. one paused GSAP timeline `main`: every cue-driven tween (titles, build-in, camera, code
//      panel, HUD, recap), placed at the cue's frame and pace (index.html registers it on
//      window.__timelines.main);
//   2. one frame source (`registerFrameSource`): continuous state (message cards, queue trays,
//      counters, consumer health, crash shards, dust, drift and shake), recomputed from the plan
//      for whatever time HyperFrames asks for. Randomness is seeded (string hash -> mulberry32).
// The two layers write disjoint elements/attributes, so seek order between them does not matter.
(() => {
  const P = window.__PLAN;
  const FPS = P.fps, W = 1920, H = 1080, END = P.total_frames;
  const NS = 'http://www.w3.org/2000/svg';
  const C = {
    bg: '#070b18', bgTop: '#101a35', grid: 'rgba(148,163,184,0.07)', ink: '#e8edf7', muted: '#8a97b3',
    broker: '#4f8cff', producer: '#a78bfa', consumer: '#cbd5e1', amber: '#ffb547', red: '#ff4d5e', green: '#34d399', codeBg: '#0d1326',
  };
  const SANS = '"Avenir Next", "Helvetica Neue", Arial, sans-serif';
  const MONO = 'Menlo, "SF Mono", monospace';
  const A = { producer: { x: 380, y: 560 }, broker: { x: 960, y: 560 }, consumer: { x: 1540, y: 560 } };

  // ---------------- pure helpers ----------------
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = gsap.parseEase('expo.out');
  const easeInOut = gsap.parseEase('power3.inOut');
  const cue = (id) => { const c = P.cues[id]; if (!c) throw new Error(`unknown cue ${id}`); return c; };
  const cueF = (id) => cue(id).frame;
  const cueP = (id, f, o = {}) => (o.ease === 'inOut' ? easeInOut : easeOut)(clamp01((f - cue(id).frame - (o.delay ?? 0)) / (o.dur ?? cue(id).frames)));
  const ramp = (f, from, dur, ease = 'out') => (ease === 'out' ? easeOut : easeInOut)(clamp01((f - from) / dur));
  const interp = (x, xs, ys) => {
    if (x <= xs[0]) return ys[0];
    for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return lerp(ys[i - 1], ys[i], (x - xs[i - 1]) / (xs[i] - xs[i - 1]));
    return ys.at(-1);
  };
  // Seeded random: same seed string -> same value in every process (FNV-1a hash -> mulberry32 step).
  const rand = (seed) => {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
    let t = (h + 0x6d2b79f5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => `rgb(${hex(a).map((v, i) => Math.round(lerp(v, hex(b)[i], clamp01(t)))).join(',')})`;
  const sec = (frames) => frames / FPS;

  // ---------------- DOM builder ----------------
  const el = (tag, attrs = {}, parent, text) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    if (text !== undefined) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  };
  const set = (n, attrs) => { for (const k in attrs) n.setAttribute(k, String(attrs[k])); };
  const svg = document.getElementById('stage');
  const defs = el('defs', {}, svg);
  defs.innerHTML = `
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="softglow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="18"/></filter>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="18" stdDeviation="16" flood-color="#000" flood-opacity="0.55"/></filter>
    <filter id="tintCyan"><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0.9  0 0 0 0 1  0 0 0 1 0"/></filter>
    <filter id="tintRed"><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 0.3  0 0 0 0 0.37  0 0 0 1 0"/></filter>
    <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c2645"/><stop offset="1" stop-color="#0e152b"/></linearGradient>
    <linearGradient id="brokerFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#173170"/><stop offset="1" stop-color="#0b1838"/></linearGradient>
    <radialGradient id="bgLight" cx="0.5" cy="0.18" r="0.75"><stop offset="0" stop-color="${C.bgTop}"/><stop offset="1" stop-color="${C.bg}"/></radialGradient>
    <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse"><path d="M 60 0 L 0 0 0 60" fill="none" stroke="${C.grid}" stroke-width="1"/></pattern>
    <pattern id="dots" width="120" height="120" patternUnits="userSpaceOnUse"><circle cx="60" cy="60" r="1.6" fill="rgba(148,163,184,0.16)"/></pattern>
    <radialGradient id="vignette" cx="0.5" cy="0.5" r="0.72"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.72"/></radialGradient>`;
  const draw0 = { pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1 }; // stroke draw-on start state

  // ---------------- timeline (GSAP) ----------------
  const tl = gsap.timeline({ paused: true, defaults: { immediateRender: false } });
  // Place a tween at a frame, for a number of frames (fromTo so random seeks are exact).
  const tw = (target, frame, frames, from, to, ease = 'expo.out') =>
    tl.fromTo(target, { ...from }, { ...to, duration: sec(frames), ease, immediateRender: false }, sec(frame));
  const init = (target, vars) => tl.set(target, vars, 0);

  // ---------------- background and world ----------------
  el('rect', { width: W, height: H, fill: 'url(#bgLight)' }, svg);
  const far = el('g', {}, svg);
  el('rect', { x: -2000, y: -2000, width: 6000, height: 5000, fill: 'url(#dots)' }, far);
  const drift = el('g', {}, svg); // frame source: ambient breathe + crash shake
  const cam = el('g', { id: 'cam' }, drift); // GSAP: camera moves
  const world = el('g', { id: 'world' }, cam); // GSAP: recap dim
  el('rect', { x: -2000, y: -2000, width: 6000, height: 5000, fill: 'url(#grid)' }, world);
  const floor = el('ellipse', { cx: 960, cy: 745, rx: 760, ry: 26, fill: '#1b2a55', filter: 'url(#softglow)', opacity: 0 }, world);

  // pipes
  const PB = 'M 478 560 C 600 470, 720 650, 832 560';
  const BC = 'M 1088 560 C 1210 470, 1330 650, 1438 560';
  const pbMeasure = el('path', { d: PB }, defs), bcMeasure = el('path', { d: BC }, defs);
  const PB_LEN = pbMeasure.getTotalLength(), BC_LEN = bcMeasure.getTotalLength();
  const pbBase = el('path', { d: PB, fill: 'none', stroke: '#24345f', 'stroke-width': 10, 'stroke-linecap': 'round', ...draw0 }, world);
  const bcBase = el('path', { d: BC, fill: 'none', stroke: '#24345f', 'stroke-width': 10, 'stroke-linecap': 'round', ...draw0 }, world);
  const flow = el('g', { opacity: 0 }, world);
  const pbFlow = el('path', { d: PB, fill: 'none', stroke: C.producer, 'stroke-width': 3, 'stroke-dasharray': '4 22', 'stroke-linecap': 'round', opacity: 0.6 }, flow);
  const bcFlow = el('path', { d: BC, fill: 'none', stroke: C.broker, 'stroke-width': 3, 'stroke-dasharray': '4 22', 'stroke-linecap': 'round', opacity: 0.6 }, flow);

  const label = (parent, y, text, fill = C.ink) =>
    el('text', { y, 'text-anchor': 'middle', 'font-family': SANS, 'font-weight': 600, 'font-size': 30, 'letter-spacing': 1, fill }, parent, text);

  // ---------------- Producer: a server rack ----------------
  const prod = el('g', { transform: `translate(${A.producer.x} ${A.producer.y})` }, world);
  const prodHalo = el('circle', { r: 170, fill: C.producer, filter: 'url(#softglow)', opacity: 0 }, prod);
  const prodFill = el('g', { opacity: 0 }, prod);
  el('rect', { x: -95, y: -125, width: 190, height: 250, rx: 18, fill: 'url(#metal)', filter: 'url(#shadow)' }, prodFill);
  label(prodFill, 170, 'Producer');
  const prodOutline = el('rect', { x: -95, y: -125, width: 190, height: 250, rx: 18, fill: 'none', stroke: C.producer, 'stroke-width': 3, ...draw0 }, prod);
  const leds = [];
  const units = [0, 1, 2, 3].map((u) => {
    const g = el('g', { opacity: 0 }, prod);
    const y = -100 + u * 56;
    el('rect', { x: -74, y, width: 148, height: 42, rx: 7, fill: '#141d38', stroke: '#2c3962', 'stroke-width': 1.5 }, g);
    for (let v = 0; v < 5; v++) el('rect', { x: -60 + v * 12, y: y + 12, width: 5, height: 18, rx: 2, fill: '#2c3962' }, g);
    for (let l = 0; l < 2; l++) leds.push({ u, l, n: el('circle', { cx: 44 + l * 16, cy: y + 21, r: 4.5, fill: '#26304f' }, g) });
    return g;
  });

  // ---------------- Consumer: a worker with a gear (body in <defs>, drawn by <use>) ----------------
  const gearPts = [];
  for (let i = 0; i < 20; i++) {
    const r = i % 2 === 0 ? 34 : 26;
    for (const a of [(i / 20) * Math.PI * 2, ((i + 1) / 20) * Math.PI * 2]) gearPts.push(`${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`);
  }
  const cbody = el('g', { id: 'cbody' }, defs);
  const consFill = el('g', { opacity: 0 }, cbody);
  el('rect', { x: -100, y: -115, width: 200, height: 230, rx: 22, fill: 'url(#metal)', filter: 'url(#shadow)' }, consFill);
  const consOutline = el('rect', { x: -100, y: -115, width: 200, height: 230, rx: 22, fill: 'none', stroke: C.consumer, 'stroke-width': 3, ...draw0 }, cbody);
  const consInner = el('g', { opacity: 0 }, cbody);
  el('rect', { x: -72, y: -92, width: 144, height: 58, rx: 10, fill: '#0b1226', stroke: '#2b3760', 'stroke-width': 1.5 }, consInner);
  const bars = [0, 1, 2].map((i) => el('rect', { x: -58, y: -80 + i * 14, width: 60, height: 7, rx: 3.5, fill: C.consumer, opacity: 0.75 }, consInner));
  const gear = el('g', { transform: 'translate(0 30)' }, consInner);
  const gearPath = el('path', { d: `M ${gearPts.join(' L ')} Z`, fill: 'none', stroke: C.consumer, 'stroke-width': 3 }, gear);
  const gearHub = el('circle', { r: 10, fill: 'none', stroke: C.consumer, 'stroke-width': 3 }, gear);
  const consX = el('g', { transform: 'translate(0 30)', stroke: C.red, 'stroke-width': 7, 'stroke-linecap': 'round', opacity: 0 }, consInner);
  el('line', { x1: -24, y1: -24, x2: 24, y2: 24 }, consX);
  el('line', { x1: 24, y1: -24, x2: -24, y2: 24 }, consX);

  const cons = el('g', { transform: `translate(${A.consumer.x} ${A.consumer.y})` }, world);
  const consHalo = el('circle', { r: 175, fill: C.consumer, filter: 'url(#softglow)', opacity: 0 }, cons);
  const consMain = el('use', { href: '#cbody' }, cons);
  const glitch = el('g', { display: 'none' }, cons);
  const SLICES = 7;
  const slices = Array.from({ length: SLICES }, (_, s) => {
    const cp = el('clipPath', { id: `slice${s}` }, defs);
    el('rect', { x: -140, y: -130 + (s * 260) / SLICES, width: 280, height: 260 / SLICES + 1 }, cp);
    const g = el('g', { 'clip-path': `url(#slice${s})` }, glitch);
    return {
      cyan: el('use', { href: '#cbody', filter: 'url(#tintCyan)', opacity: 0.55 }, g),
      red: el('use', { href: '#cbody', filter: 'url(#tintRed)', opacity: 0.75 }, g),
      main: el('use', { href: '#cbody' }, g),
    };
  });
  const recoverRing = el('circle', { r: 120, fill: 'none', stroke: C.green, 'stroke-width': 4, opacity: 0 }, cons);
  const consLabelG = el('g', { opacity: 0 }, cons);
  const consLabel = label(consLabelG, 165, 'Consumer');

  // ---------------- Broker: cabinet of trays that opens into a queue ----------------
  const brk = el('g', { transform: `translate(${A.broker.x} ${A.broker.y})` }, world);
  const brkHalo = el('circle', { r: 190, fill: C.broker, filter: 'url(#softglow)', opacity: 0 }, brk);
  const brkFill = el('g', { opacity: 0 }, brk);
  const brkBody = el('rect', { rx: 22, fill: 'url(#brokerFill)', filter: 'url(#shadow)' }, brkFill);
  const brkHeader = el('g', {}, brkFill);
  const brkStrip = el('rect', { height: 22, rx: 6, fill: '#20408f' }, brkHeader);
  const brkLeds = [0, 1, 2].map((i) => el('circle', { r: 4, fill: i === 0 ? C.broker : '#4b67b0' }, brkHeader));
  const brkOutline = el('rect', { rx: 22, fill: 'none', stroke: C.broker, 'stroke-width': 3.5, filter: 'url(#glow)', ...draw0 }, brk);
  const brkQueue = el('text', { 'font-family': MONO, 'font-size': 15, fill: '#9db8ff', 'letter-spacing': 1, opacity: 0 }, brk, 'queue: orders');
  const trays = [0, 1, 2, 3].map(() => {
    const g = el('g', { opacity: 0 }, brk);
    return {
      g,
      halo: el('circle', { fill: C.amber, filter: 'url(#softglow)', opacity: 0 }, g),
      rect: el('rect', {}, g),
      text: el('text', { y: 6, 'text-anchor': 'middle', 'font-family': MONO, 'font-size': 13 }, g),
      bar: el('rect', { y: -4, height: 8, rx: 4, opacity: 0 }, g),
    };
  });
  const brkOverflow = el('text', { 'text-anchor': 'end', 'font-family': MONO, fill: '#9db8ff' }, brk);
  const brkLabelG = el('g', { opacity: 0 }, brk);
  const brkLabel = label(brkLabelG, 205, 'Broker', '#cfe0ff');
  const brkAckFlash = el('rect', { y: -150, height: 300, rx: 22, fill: 'none', stroke: C.green, 'stroke-width': 6, filter: 'url(#glow)', opacity: 0 }, brk);
  const brkAwait = el('g', { transform: 'translate(-243 82)', opacity: 0 }, brk);
  const awaitDot = el('circle', { cx: -52, cy: -6, r: 6, fill: C.amber }, brkAwait);
  el('text', { x: -40, y: 0, 'font-family': SANS, 'font-weight': 600, 'font-size': 17, fill: C.amber }, brkAwait, 'awaiting ack');

  // ---------------- message cards, ack pulses, crash shards (pools) ----------------
  const toneColor = { neutral: '#c9d4ff', amber: C.amber, green: C.green, red: C.red };
  const cardLayer = el('g', {}, world);
  const cards = Array.from({ length: 24 }, () => {
    const g = el('g', { display: 'none' }, cardLayer);
    return {
      g,
      rect: el('rect', { x: -82, y: -21, width: 164, height: 42, rx: 11, fill: '#0e1730', 'stroke-width': 2.2, filter: 'url(#glow)' }, g),
      text: el('text', { y: 6, 'text-anchor': 'middle', 'font-family': MONO, 'font-size': 16 }, g),
    };
  });
  const pulseLayer = el('g', {}, world);
  const pulses = Array.from({ length: 8 }, () => {
    const g = el('g', { display: 'none' }, pulseLayer);
    return { g, big: el('circle', { fill: C.green, opacity: 0.35, filter: 'url(#softglow)' }, g), dot: el('circle', { fill: C.green, filter: 'url(#glow)' }, g) };
  });
  const shardLayer = el('g', {}, world);
  const shards = Array.from({ length: 46 }, (_, i) => {
    const size = 6 + rand(`s${i}`) * 18;
    const k = rand(`k${i}`);
    return {
      a: rand(`a${i}`) * Math.PI * 2, v: 6 + rand(`v${i}`) * 16, spin: (rand(`r${i}`) - 0.5) * 24,
      n: el('polygon', { points: `0,${-size} ${size * (0.5 + k * 0.5)},${size * 0.6} ${-size * 0.7},${size * (0.2 + k * 0.4)}`, fill: k > 0.45 ? C.red : '#ffd0d5', display: 'none' }, shardLayer),
    };
  });

  // ---------------- screen-space overlays ----------------
  const dust = Array.from({ length: 70 }, (_, i) => ({
    x0: rand(`dx${i}`) * W, y0: rand(`dy${i}`) * H, sp: 0.15 + rand(`ds${i}`) * 0.5, o0: 0.3 + rand(`do${i}`) * 0.7,
    n: el('circle', { r: 0.8 + rand(`dr${i}`) * 2.2, fill: '#9fb4ff' }, svg),
  }));
  el('rect', { width: W, height: H, fill: 'url(#vignette)' }, svg);
  const redFlash = el('rect', { width: W, height: H, fill: C.red, opacity: 0 }, svg);

  // Opening question (writeTitle / indicate / dockTitle)
  const qOuter = el('g', {}, svg);
  const qDock = el('g', {}, qOuter);
  const hookWords = P.words.filter((w) => w.scene === 'hook');
  const qLines = [el('text', { y: -40 }, qDock), el('text', { y: 72 }, qDock)];
  for (const t of qLines) set(t, { 'text-anchor': 'middle', 'font-family': SANS, 'font-weight': 700, 'font-size': 92, 'letter-spacing': -1 });
  const qSpans = hookWords.map((w, i) =>
    el('tspan', { fill: C.ink, 'fill-opacity': 0, stroke: C.ink, 'stroke-width': 2, 'stroke-opacity': 0, 'stroke-dasharray': 600, 'stroke-dashoffset': 600 }, qLines[i < 5 ? 0 : 1], w.text + ' '),
  );
  const qUnder = el('rect', { x: -260, y: 118, width: 0, height: 6, rx: 3, fill: C.broker, opacity: 0.9 }, qDock);

  // Recap title + chips
  const recapG = el('g', { transform: 'translate(960 210)' }, svg);
  const recapText = el('text', { 'text-anchor': 'middle', 'font-family': SANS, 'font-weight': 700, 'font-size': 104, 'letter-spacing': -1 }, recapG);
  const recapWords = P.words.filter((w) => w.scene === 'recap').slice(0, 3);
  const recapSpans = recapWords.map((w, i) => {
    const c = i === 2 ? C.green : C.ink;
    return el('tspan', { fill: c, 'fill-opacity': 0, stroke: c, 'stroke-width': 2, 'stroke-opacity': 0, 'stroke-dasharray': 700, 'stroke-dashoffset': 700 }, recapText, w.text + ' ');
  });
  const chips = [
    { id: 'chip_ack', text: 'ack after the work', c: C.green, x: -250 },
    { id: 'chip_survive', text: 'unacked = redelivered', c: C.amber, x: 250 },
  ].map((c) => {
    const outer = el('g', { transform: `translate(${c.x} 110)` }, recapG);
    const g = el('g', { opacity: 0 }, outer);
    el('rect', { x: -215, y: -34, width: 430, height: 68, rx: 34, fill: 'rgba(10,16,34,0.85)', stroke: c.c, 'stroke-width': 2.5, filter: 'url(#glow)' }, g);
    el('circle', { cx: -178, cy: 0, r: 15, fill: c.c }, g);
    el('path', { d: 'M -185 0 L -179 6 L -170 -6', fill: 'none', stroke: '#06101f', 'stroke-width': 4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
    el('text', { x: -150, y: 10, 'font-family': MONO, 'font-size': 28, fill: C.ink }, g, c.text);
    return { ...c, g };
  });

  // Live counters (HUD)
  const hudOuter = el('g', { transform: 'translate(1460 130)' }, svg);
  const hud = el('g', { opacity: 0 }, hudOuter);
  el('rect', { width: 380, height: 140, rx: 18, fill: 'rgba(12,20,44,0.78)', stroke: 'rgba(79,140,255,0.45)', 'stroke-width': 2, filter: 'url(#shadow)' }, hud);
  const hudRows = ['in_queue', 'delivery_count'].map((k, i) => {
    const g = el('g', { transform: `translate(28 ${52 + i * 54})` }, hud);
    el('text', { 'font-family': MONO, 'font-size': 26, fill: C.muted }, g, k);
    const cp = el('clipPath', { id: `roll${i}` }, defs);
    el('rect', { x: 260, y: -30, width: 90, height: 40 }, cp);
    const cg = el('g', { 'clip-path': `url(#roll${i})` }, g);
    // The clip is in the row's local space; clipPathUnits default to the referencing element's user space.
    return el('text', { x: 330, 'text-anchor': 'end', 'font-family': MONO, 'font-weight': 700, 'font-size': 32 }, cg);
  });

  // Code panel (codeHighlight); production would use the FR1-021 block via Shiki.
  const K = '#c792ea', F = '#82aaff', S = '#c3e88d', Pu = '#89ddff', T = '#e6ecff', Cm = '#6b7a99';
  const CODE = [
    [['channel', T], ['.', Pu], ['consume', F], ['(', Pu], ["'orders'", S], [', ', Pu], ['async ', K], ['(msg) ', T], ['=>', K], [' {', Pu]],
    [['  const ', K], ['order ', T], ['= ', Pu], ['JSON', T], ['.', Pu], ['parse', F], ['(msg.content);', T]],
    [['  await ', K], ['chargeCard', F], ['(order);', T], ['    // the work', Cm]],
    [['  channel', T], ['.', Pu], ['ack', F], ['(msg);', T], ['        // then ack', Cm]],
    [['});', Pu]],
  ];
  const CHAR_W = 26 * 0.602; // Menlo advance width at 26 px
  const code = el('g', { opacity: 0 }, svg);
  el('rect', { width: 830, height: 400, rx: 20, fill: C.codeBg, stroke: 'rgba(130,170,255,0.25)', 'stroke-width': 2, filter: 'url(#shadow)' }, code);
  el('rect', { width: 830, height: 52, rx: 20, fill: '#141c36' }, code);
  el('rect', { y: 32, width: 830, height: 20, fill: '#141c36' }, code);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => el('circle', { cx: 30 + i * 24, cy: 26, r: 7, fill: c }, code));
  el('text', { x: 415, y: 33, 'text-anchor': 'middle', 'font-family': MONO, 'font-size': 18, fill: C.muted }, code, 'consumer.js');
  const workBar = el('rect', { x: 14, y: 78 + 2 * 56 - 6, width: 802, height: 48, rx: 8, fill: C.amber, opacity: 0 }, code);
  const ackBar = el('rect', { x: 14, y: 78 + 3 * 56 - 6, width: 802, height: 48, rx: 8, fill: C.green, 'fill-opacity': 0, stroke: C.green, 'stroke-opacity': 0, 'stroke-width': 2, filter: 'url(#glow)' }, code);
  const codeLines = CODE.map((line, li) => {
    const g = el('g', {}, code);
    const y = 78 + li * 56 + 26;
    el('text', { x: 40, y, 'font-family': MONO, 'font-size': 26, fill: '#46527a', 'xml:space': 'preserve' }, g, String(li + 1).padStart(2, ' '));
    const cp = el('clipPath', { id: `line${li}` }, defs);
    const clip = el('rect', { x: 40 + 4 * CHAR_W, y: y - 34, width: 0, height: 48 }, cp);
    const t = el('text', { x: 40 + 4 * CHAR_W, y, 'font-family': MONO, 'font-size': 26, 'xml:space': 'preserve', 'clip-path': `url(#line${li})` }, g);
    for (const [s, c] of line) el('tspan', { fill: c }, t, s);
    return { g, clip, chars: line.reduce((a, [s]) => a + s.length, 0) };
  });

  // Persistent chrome: series kicker and the AI notice on every frame (FR2-020)
  el('text', { x: 80, y: 70, 'font-family': SANS, 'font-weight': 600, 'font-size': 20, 'letter-spacing': 4, fill: C.muted }, svg, P.title.toUpperCase());
  const badge = el('g', { transform: 'translate(1840 70)' }, svg);
  el('rect', { x: -150, y: -24, width: 150, height: 34, rx: 17, fill: 'rgba(255,255,255,0.06)', stroke: 'rgba(255,255,255,0.14)' }, badge);
  el('text', { x: -75, y: -1, 'text-anchor': 'middle', 'font-family': SANS, 'font-weight': 600, 'font-size': 17, fill: C.muted }, badge, 'AI-generated');

  // Captions (burned in only when the `captions` variable is true)
  const vars = window.__hyperframes?.getVariables?.() ?? {};
  const capRoot = document.getElementById('captions');
  const capBox = document.createElement('div');
  capBox.className = 'box';
  capRoot.appendChild(capBox);
  if (vars.captions === true) capRoot.classList.add('on');

  // =====================================================================================
  // Recipes: one function per storyboard verb, adding tweens at the cue's frame.
  // =====================================================================================
  const wordFrame = (w) => Math.floor((w.start_ms * FPS) / 1000) - 4;
  const writeWords = (spans, words, dash) =>
    spans.forEach((s, i) => {
      const f0 = wordFrame(words[i]);
      tw(s, f0, 14, { attr: { 'stroke-dashoffset': dash, 'stroke-opacity': 0 } }, { attr: { 'stroke-dashoffset': 0, 'stroke-opacity': 1 } });
      tw(s, f0 + 5, 9, { attr: { 'fill-opacity': 0 } }, { attr: { 'fill-opacity': 1 } }, 'power2.out');
    });
  const camAt = (s, cx, cy) => ({ x: W / 2 - s * cx, y: H / 2 - s * cy, scale: s });
  init(cam, { svgOrigin: '0 0', ...camAt(1, 960, 550) });
  init(qDock, { svgOrigin: '0 0', x: 960, y: 500, scale: 1 });
  init(code, { svgOrigin: '0 0', x: 1150, y: 300, scale: 1 });
  init(hud, { y: -16 });

  const build = {
    producer(c) {
      tw(prodOutline, c.frame, 30, { attr: { 'stroke-dashoffset': 1 } }, { attr: { 'stroke-dashoffset': 0 } });
      tw(prodFill, c.frame + 12, 18, { opacity: 0 }, { opacity: 1 }, 'power2.out');
      units.forEach((u, i) => tw(u, c.frame + 9 + i * 4, 9, { opacity: 0, y: 10 }, { opacity: 1, y: 0 }));
    },
    pipe_pb: (c) => tw(pbBase, c.frame, 24, { attr: { 'stroke-dashoffset': 1 } }, { attr: { 'stroke-dashoffset': 0 } }, 'power3.inOut'),
    broker(c) {
      tw(brkOutline, c.frame, 30, { attr: { 'stroke-dashoffset': 1 } }, { attr: { 'stroke-dashoffset': 0 } });
      tw([brkFill, brkLabelG], c.frame + 12, 18, { opacity: 0 }, { opacity: 1 }, 'power2.out');
      tw(floor, c.frame, 30, { opacity: 0 }, { opacity: 0.35 });
    },
    consumer(c) {
      tw(consOutline, c.frame, 30, { attr: { 'stroke-dashoffset': 1 } }, { attr: { 'stroke-dashoffset': 0 } });
      tw([consFill, consInner, consLabelG], c.frame + 13, 17, { opacity: 0 }, { opacity: 1 }, 'power2.out');
    },
    pipe_bc: (c) => tw(bcBase, c.frame, 24, { attr: { 'stroke-dashoffset': 1 } }, { attr: { 'stroke-dashoffset': 0 } }, 'power3.inOut'),
  };
  const recipes = {
    writeTitle: () => writeWords(qSpans, hookWords, 600),
    indicate(c) {
      const s = qSpans.at(-1);
      tw(s, c.frame, 10, { attr: { fill: C.ink, stroke: C.ink } }, { attr: { fill: C.red, stroke: C.red } }, 'power2.out');
    },
    dockTitle(c) {
      tw(qDock, c.frame, 30, { x: 960, y: 500, scale: 1 }, { x: 960, y: 104, scale: 0.4 }, 'power3.inOut');
      tw(qUnder, c.frame + 16, 30, { attr: { width: 0 } }, { attr: { width: 520 } });
    },
    buildPipeline: (c) => build[c.id](c),
    streamMessages(c) {
      // Cards, trays and counters are continuous state in the frame source; the first cue only
      // eases the camera into a slow push so the stream never sits on a static frame.
      if (c.id === 'stream') tw(cam, c.frame, 120, camAt(1, 960, 550), camAt(1.035, 960, 550), 'power3.inOut');
    },
    crash() { }, // shards, glitch, shake and red flash: frame source
    zoomAndOpen(c) {
      if (c.id === 'zoom') tw(cam, c.frame, 42, camAt(1.035, 960, 550), camAt(2.15, 960, 570), 'power3.inOut');
      if (c.id === 'counters') tw(hud, c.frame, 18, { opacity: 0, y: -16 }, { opacity: 1, y: 0 });
    },
    codeHighlight(c) {
      if (c.id === 'split') {
        tw(cam, c.frame, 36, camAt(2.15, 960, 570), camAt(1.35, 960 + 450 / 1.35, 570), 'power3.inOut');
        tw(cam, c.frame + 36, 100, camAt(1.35, 960 + 450 / 1.35, 570), camAt(1.42, 960 + 450 / 1.42, 570), 'power3.inOut');
        tw(code, c.frame, 26, { opacity: 0, x: 1150 }, { opacity: 1, x: 1030 });
        codeLines.forEach((l, li) =>
          tw(l.clip, c.frame + 8 + li * 6, 10, { attr: { width: 0 } }, { attr: { width: l.chars * CHAR_W + 2 } }, `steps(${l.chars})`),
        );
      }
      if (c.id === 'work_line') {
        tw(workBar, c.frame, 8, { opacity: 0 }, { opacity: 0.16 });
        codeLines.forEach((l, li) => li !== 2 && tw(l.g, c.frame, 8, { opacity: 1 }, { opacity: 0.6 }));
      }
      if (c.id === 'ack_line') {
        tw(workBar, c.frame, 8, { opacity: 0.16 }, { opacity: 0 });
        tw(ackBar, c.frame, 8, { attr: { 'fill-opacity': 0, 'stroke-opacity': 0 } }, { attr: { 'fill-opacity': 0.2, 'stroke-opacity': 0.8 } });
        codeLines.forEach((l, li) => tw(l.g, c.frame, 8, { opacity: li === 2 ? 1 : 0.6 }, { opacity: li === 3 ? 1 : 0.55 }));
      }
    },
    redeliver(c) {
      if (c.id === 'pullback') {
        tw(cam, c.frame, 40, camAt(1.42, 960 + 450 / 1.42, 570), camAt(1, 960, 550), 'power3.inOut');
        tw(code, c.frame, 30, { x: 1030, y: 300, scale: 1 }, { x: 80, y: 128, scale: 0.6 }, 'power3.inOut');
      }
      if (c.id === 'ack') {
        tw(ackBar, c.frame, 3, { attr: { 'fill-opacity': 0.2 } }, { attr: { 'fill-opacity': 0.5 } }, 'none');
        tw(ackBar, c.frame + 3, 17, { attr: { 'fill-opacity': 0.5 } }, { attr: { 'fill-opacity': 0.2 } }, 'power1.out');
      }
    },
    recap(c) {
      if (c.id === 'title_lost') {
        tw(cam, c.frame, 150, camAt(1, 960, 550), camAt(1.06, 960, 510), 'power3.inOut');
        tw(world, c.frame, 24, { opacity: 1 }, { opacity: 0.5 }, 'power3.inOut');
        tw(qOuter, c.frame, 16, { opacity: 1, y: 0 }, { opacity: 0, y: -30 });
        tw(hud, c.frame, 14, { opacity: 1 }, { opacity: 0 });
        tw(code, c.frame, 16, { opacity: 1 }, { opacity: 0 });
        writeWords(recapSpans, recapWords, 700);
      } else {
        const chip = chips.find((x) => x.id === c.id);
        tw(chip.g, c.frame, 20, { opacity: 0, y: 24 }, { opacity: 1, y: 0 });
      }
    },
  };
  for (const c of Object.values(P.cues)) recipes[c.do](c);
  tl.set({}, {}, sec(END)); // the timeline spans the whole video
  window.__explainer = { timeline: tl }; // registered as window.__timelines.main by index.html

  // =====================================================================================
  // Frame source: continuous state as a pure function of the frame (port of Explainer.tsx).
  // =====================================================================================
  const sim = P.sim;
  const msgs = sim.msgs;
  const victim = msgs[sim.victim];
  const at = (path, len, t) => path.getPointAtLength(len * clamp01(t));
  const easeC = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const readyAt = (f) => msgs.filter((m) => m.arrive <= f && (m.deliveries[0] === undefined || f < m.deliveries[0]));
  const victimParked = (f) => f >= sim.crash && f < (victim.deliveries[1] ?? Infinity);
  const deliveryCount = (f) => victim.deliveries.filter((d) => d <= f).length;
  const unackedAt = (f) => msgs.filter((m) => m.deliveries[0] !== undefined && m.deliveries[0] <= f && f < (m.ack_arrive ?? Infinity)).length;
  const inQueueAt = (f) => readyAt(f).length + unackedAt(f);
  const show = (n, on) => n.setAttribute('display', on ? 'inline' : 'none');
  const tr = (x, y, s = 1, r = 0) => `translate(${x.toFixed(2)} ${y.toFixed(2)})${s !== 1 ? ` scale(${s.toFixed(4)})` : ''}${r ? ` rotate(${r.toFixed(2)})` : ''}`;

  function render(f) {
    // ----- ambient drift (a slow 1-2 % breathe) and the seeded crash shake -----
    const since = f - sim.crash;
    const amp = since >= 0 && since < 18 ? 14 * (1 - since / 18) : 0;
    const sx = amp * (rand(`sx${f}`) * 2 - 1), sy = amp * (rand(`sy${f}`) * 2 - 1);
    const k = 1 + 0.012 * Math.sin(f / 55), dx = 7 * Math.sin(f / 80), dy = 4 * Math.cos(f / 67);
    drift.setAttribute('transform', `translate(${(W / 2 + sx).toFixed(2)} ${(H / 2 + sy).toFixed(2)}) scale(${k.toFixed(5)}) translate(${(-W / 2 - dx).toFixed(2)} ${(-H / 2 - dy).toFixed(2)})`);
    far.setAttribute('transform', `translate(${(-0.4 * dx).toFixed(2)} ${(-0.4 * dy).toFixed(2)})`);

    // ----- build-in progress the continuous layer needs -----
    const fillOf = (id) => clamp01((cueP(id, f, { dur: 30 }) - 0.45) / 0.55);
    const pBroker = cueP('broker', f, { dur: 30 });
    const prodO = fillOf('producer'), consO = fillOf('consumer'), brkO = clamp01((pBroker - 0.4) / 0.6);
    const open = cueP('zoom', f, { dur: 36, delay: 8, ease: 'inOut' }) * (1 - cueP('pullback', f, { dur: 28, ease: 'inOut' }));
    const awaitP = cueP('await', f, { dur: 18 });
    const halfW = lerp(125, 340, open);
    const breathe = 0.5 + 0.5 * Math.sin(f / 14);

    // ----- consumer health -----
    const crashT = f - sim.crash;
    const recoverF = cueF('recover');
    const recoverP = cueP('recover', f, { dur: 26 });
    const crashed = crashT >= 0 && recoverP < 1;
    const redness = crashT < 0 ? 0 : clamp01(crashT / 6) * (1 - recoverP);
    const tone = recoverP > 0.01 ? mix(C.red, C.green, recoverP) : redness > 0 ? mix(C.consumer, C.red, redness) : C.consumer;
    const gearRot = 4 * (f < sim.crash ? f : f < recoverF ? sim.crash : sim.crash + (f - recoverF));

    // ----- flow dashes -----
    flow.setAttribute('opacity', ((f >= cueF('pipe_bc') ? 1 : 0) * (1 - open * 0.8) * 0.9).toFixed(3));
    pbFlow.setAttribute('stroke-dashoffset', (-f * 2.2).toFixed(1));
    set(bcFlow, { stroke: crashed ? C.red : C.broker, 'stroke-dashoffset': (crashed ? -sim.crash * 2.2 : -f * 2.2).toFixed(1) });

    // ----- cards on pipes, at the consumer, ack pulses -----
    let ci = 0, pi = 0, eat = 0, emit = 0;
    const card = (x, y, label, tn, s, o) => {
      const c = cards[ci++];
      if (!c) return;
      show(c.g, true);
      set(c.g, { transform: tr(x, y, s), opacity: clamp01(o).toFixed(3) });
      c.rect.setAttribute('stroke', toneColor[tn]);
      set(c.text, { fill: tn === 'neutral' ? '#e6ecff' : toneColor[tn] });
      if (c.text.textContent !== label) c.text.textContent = label;
    };
    for (const m of msgs) {
      emit = Math.max(emit, interp(f - m.spawn, [0, 3, 14], [0, 1, 0]));
      if (f >= m.spawn && f < m.arrive) {
        const t = (f - m.spawn) / sim.T_PB;
        const pt = at(pbMeasure, PB_LEN, easeC(t));
        const o = clamp01((A.broker.x - halfW - 60 - pt.x) / 40) * clamp01((f - m.spawn) / 4);
        card(pt.x, pt.y - 4, m.label, 'neutral', lerp(0.5, 0.78, clamp01(t * 3)), o);
      }
      m.deliveries.forEach((d, j) => {
        const isVictimFirst = m.victim && j === 0;
        const arriveC = d + sim.T_BC;
        if (f >= d && f < arriveC) {
          const pt = at(bcMeasure, BC_LEN, easeC((f - d) / sim.T_BC));
          card(pt.x, pt.y - 4, m.label, 'amber', 0.78, clamp01((pt.x - (A.broker.x + halfW + 60)) / 40));
        }
        const end = isVictimFirst ? sim.crash : m.ack_start ?? arriveC + sim.PROC;
        const tail = isVictimFirst ? 10 : 6;
        if (f >= arriveC && f < end + tail) {
          const kk = clamp01((f - arriveC) / Math.max(1, end - arriveC));
          const done = f >= end;
          const fade = done ? 1 - clamp01((f - end) / tail) : 1;
          const tn = isVictimFirst && done ? 'red' : done ? 'green' : 'amber';
          card(A.consumer.x, A.consumer.y - 150 + 18 * kk, m.label, tn, lerp(1, 0.86, kk) * (isVictimFirst && done ? 1 + 0.4 * (1 - fade) : 1), fade);
          eat = Math.max(eat, interp(f - arriveC, [0, 4, sim.PROC + 6], [0, 1, 0]));
        }
      });
      if (m.ack_start !== null && f >= m.ack_start && f < m.ack_arrive + 8) {
        const p = pulses[pi++];
        if (p) {
          const pt = at(bcMeasure, BC_LEN, 1 - easeC(Math.min(1, (f - m.ack_start) / sim.T_ACK)));
          const big = m.victim ? 1.8 : 1;
          show(p.g, true);
          p.g.setAttribute('opacity', (f < m.ack_arrive ? 1 : 1 - (f - m.ack_arrive) / 8).toFixed(3));
          set(p.big, { cx: pt.x.toFixed(2), cy: pt.y.toFixed(2), r: 13 * big });
          set(p.dot, { cx: pt.x.toFixed(2), cy: pt.y.toFixed(2), r: 6 * big });
        }
      }
    }
    for (; ci < cards.length; ci++) show(cards[ci].g, false);
    for (; pi < pulses.length; pi++) show(pulses[pi].g, false);

    // ----- producer -----
    prod.setAttribute('opacity', (1 - 0.85 * open).toFixed(3));
    prodHalo.setAttribute('opacity', ((0.12 + 0.18 * emit) * prodO).toFixed(3));
    for (const { u, l, n } of leds) n.setAttribute('fill', Math.sin(f / (4 + u + l * 3) + u * 2 + l) > 0.1 ? (l ? C.producer : C.green) : '#26304f');

    // ----- consumer -----
    cons.setAttribute('opacity', (1 - 0.85 * open).toFixed(3));
    set(consHalo, { fill: tone, opacity: ((0.1 + 0.25 * eat + 0.35 * redness + 0.3 * recoverP * (1 - recoverP * 0.6)) * consO).toFixed(3) });
    consOutline.setAttribute('stroke', tone);
    bars.forEach((b, i) => set(b, { fill: tone, width: (crashed ? 30 + i * 10 : 60 + 40 * Math.abs(Math.sin(f / 9 + i))).toFixed(2) }));
    gear.setAttribute('transform', `translate(0 30) rotate(${gearRot})`);
    gearPath.setAttribute('stroke', tone);
    gearHub.setAttribute('stroke', tone);
    consX.setAttribute('opacity', crashed && crashT > 6 ? clamp01((crashT - 6) / 6).toFixed(3) : '0');
    consLabel.setAttribute('fill', redness > 0.5 ? '#ffb3bb' : C.ink);
    const glitching = crashT >= 0 && crashT < 16;
    show(consMain, !glitching);
    show(glitch, glitching);
    if (glitching)
      slices.forEach((s, i) => {
        const off = (rand(`g${i}-${f}`) - 0.5) * 50 * (1 - crashT / 16);
        s.cyan.setAttribute('transform', `translate(${(off - 6).toFixed(2)} 0)`);
        s.red.setAttribute('transform', `translate(${(off + 6).toFixed(2)} 0)`);
        s.main.setAttribute('transform', `translate(${off.toFixed(2)} 0)`);
      });
    set(recoverRing, { r: (120 + 120 * recoverP).toFixed(2), opacity: recoverP > 0 && recoverP < 1 ? (1 - recoverP).toFixed(3) : 0 });

    // ----- broker -----
    const w = lerp(250, 680, open), h = lerp(300, 200, open);
    set(brkHalo, { r: lerp(190, 300, open).toFixed(2), opacity: ((0.2 + 0.08 * breathe) * brkO * (1 - 0.7 * open)).toFixed(3) });
    for (const r of [brkBody, brkOutline]) set(r, { x: (-w / 2).toFixed(2), y: (-h / 2).toFixed(2), width: w.toFixed(2), height: h.toFixed(2) });
    brkHeader.setAttribute('opacity', (1 - open).toFixed(3));
    set(brkStrip, { x: (-w / 2 + 18).toFixed(2), y: (-h / 2 + 16).toFixed(2), width: (w - 36).toFixed(2) });
    brkLeds.forEach((n, i) => set(n, { cx: (-w / 2 + 34 + i * 16).toFixed(2), cy: (-h / 2 + 27).toFixed(2) }));
    set(brkQueue, { x: (-w / 2 + 28).toFixed(2), y: (-h / 2 + 30).toFixed(2), opacity: open.toFixed(3) });
    set(brkLabel, { y: lerp(205, 150, open).toFixed(2), opacity: (1 - open).toFixed(3) });

    const ready = readyAt(f);
    const parked = victimParked(f);
    const slot = [...(parked ? [{ m: victim, tone: 'unacked' }] : []), ...ready.map((m) => ({ m, tone: 'ready' }))];
    trays.forEach((t, kk) => {
      const s = slot[kk];
      const tn = s ? s.tone : 'empty';
      const enter = s ? clamp01((s.tone === 'unacked' ? f - sim.crash : f - s.m.arrive) / 12) : 0;
      const tw_ = lerp(190, 148, open), th = lerp(36, 82, open);
      set(t.g, { transform: tr(lerp(0, -243 + kk * 162, open), lerp(95 - kk * 50, 16, open)), opacity: clamp01((pBroker - 0.5 - kk * 0.1) / 0.3).toFixed(3) });
      const stroke = tn === 'unacked' ? C.amber : tn === 'ready' ? C.broker : '#2a3b6e';
      const fill = tn === 'unacked' ? 'rgba(255,181,71,0.16)' : tn === 'ready' ? 'rgba(79,140,255,0.22)' : 'rgba(20,32,70,0.6)';
      const pop = tn === 'empty' ? 0 : interp(enter, [0, 0.5, 1], [0, 1, 0]);
      set(t.rect, { x: (-tw_ / 2).toFixed(2), y: (-th / 2).toFixed(2), width: tw_.toFixed(2), height: th.toFixed(2), rx: lerp(8, 12, open).toFixed(2), fill, stroke, 'stroke-width': (2.5 + pop * 3).toFixed(2), filter: tn === 'empty' ? 'none' : 'url(#glow)' });
      set(t.halo, { r: (70 + 20 * awaitP).toFixed(2), opacity: tn === 'unacked' ? (0.25 + 0.35 * awaitP * breathe).toFixed(3) : 0 });
      const lbl = s ? s.m.label : '';
      if (t.text.textContent !== lbl) t.text.textContent = lbl;
      set(t.text, { fill: tn === 'unacked' ? '#ffe2b0' : '#dbe6ff', opacity: open.toFixed(3) });
      const barOn = open < 0.5 && tn !== 'empty';
      set(t.bar, { x: (-tw_ / 2 + 12).toFixed(2), width: (tw_ - 24).toFixed(2), fill: tn === 'unacked' ? C.amber : C.broker, opacity: barOn ? ((tn === 'unacked' ? 1 : 0.75) * (1 - open * 2)).toFixed(3) : 0 });
    });
    const overflow = Math.max(0, slot.length - 4);
    brkOverflow.textContent = overflow > 0 ? `+${overflow}` : '';
    set(brkOverflow, { x: lerp(104, 312, open).toFixed(2), y: lerp(-96, -64, open).toFixed(2), 'font-size': lerp(20, 17, open).toFixed(2) });
    const ackFlash = interp(f - victim.ack_arrive, [0, 4, 24], [0, 1, 0]);
    set(brkAckFlash, { x: (-halfW).toFixed(2), width: (halfW * 2).toFixed(2), opacity: ackFlash.toFixed(3) });
    brkAwait.setAttribute('opacity', (awaitP * open * (parked ? 1 : 0)).toFixed(3));
    awaitDot.setAttribute('opacity', (0.5 + 0.5 * Math.sin(f / 5)).toFixed(3));

    // ----- crash shards, red flash -----
    const st = f - sim.crash;
    shards.forEach((s) => {
      if (st < 0 || st > 60) return show(s.n, false);
      const drag = 1 - Math.exp(-st / 14);
      const x = A.consumer.x + Math.cos(s.a) * s.v * 14 * drag;
      const y = A.consumer.y + Math.sin(s.a) * s.v * 14 * drag + 0.06 * st * st;
      show(s.n, true);
      set(s.n, { transform: tr(x, y, 1, s.spin * st || 0.0001), opacity: interp(st, [0, 40, 60], [1, 0.7, 0]).toFixed(3) });
    });
    redFlash.setAttribute('opacity', interp(crashT, [0, 2, 12], [0, 0.16, 0]).toFixed(3));

    // ----- dust -----
    dust.forEach((d, i) => {
      const x = (d.x0 + f * d.sp * 0.6) % W;
      const y = (d.y0 - f * d.sp + H * 4) % H;
      const twk = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(f / (12 + (i % 9)) + i));
      set(d.n, { cx: x.toFixed(2), cy: y.toFixed(2), opacity: (twk * d.o0).toFixed(3) });
    });

    // ----- question: the "crashes?" word shivers on its cue -----
    const sq = f - cueF('q_crash');
    qSpans.at(-1).setAttribute('dx', sq >= 0 && sq < 10 ? (Math.sin(sq * 7) * 6).toFixed(2) : '0');

    // ----- live counters: the number rolls in when it changed within the last 10 frames -----
    [[inQueueAt, () => C.broker], [deliveryCount, (v) => (v > 1 ? C.amber : C.ink)]].forEach(([hist, col], i) => {
      let changed = -1;
      for (let g = 0; g < 10; g++) if (hist(f - g) !== hist(f - g - 1)) { changed = g; break; }
      const roll = changed >= 0 ? ramp(changed, 0, 10) : 1;
      const v = hist(f);
      const n = hudRows[i];
      if (n.textContent !== String(v)) n.textContent = String(v);
      set(n, { y: (22 * (1 - roll)).toFixed(2), opacity: roll.toFixed(3), fill: col(v) });
    });

    // ----- burned-in captions -----
    if (vars.captions === true) {
      const ms = (f * 1000) / FPS;
      const c = P.captions.find((x) => ms >= x.start_ms && ms < x.end_ms);
      const html = c ? c.lines.map((l) => `<div>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`).join('') : '';
      if (capBox.innerHTML !== html) capBox.innerHTML = html;
    }
  }

  window.__hyperframes.registerFrameSource({
    element: document.getElementById('sim'),
    ready: document.fonts.ready,
    render: (t) => render(Math.min(END - 1, Math.max(0, Math.round(t * FPS)))),
  });
  render(0);
})();
