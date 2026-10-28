// The composition: draws the state that the timeline, simulation, and recipes compute for the
// current frame. No timers, no Math.random, no fetches (FR2-026 determinism).
import React from 'react';
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { getLength, getPointAtLength } from '@remotion/paths';
import narration from './generated/narration.json';
import { storyboard, wordsOf } from './storyboard';
import { buildTimeline, type Timeline } from './timeline';
import { buildSim, deliveryCount, PROC, readyAt, T_ACK, T_BC, T_PB, victimParked, type Msg } from './sim';
import { camera, cameraTransform, clamp01, crashShards, cueF, cueP, dust, lerp, ramp } from './motion';
import { anchor, color, FPS, font, HEIGHT, WIDTH } from './theme';
import { BrokerCabinet, ConsumerWorker, Defs, MessageCard, ProducerRack, type Tone, type Tray } from './illustrations';

export const timeline: Timeline = buildTimeline(storyboard.scenes, narration.scenes);
const sim = buildSim(timeline);

// ---------------- paths ----------------
const PB = 'M 478 560 C 600 470, 720 650, 832 560';
const BC = 'M 1088 560 C 1210 470, 1330 650, 1438 560';
const PB_LEN = getLength(PB);
const BC_LEN = getLength(BC);
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const at = (path: string, len: number, t: number) => getPointAtLength(path, len * clamp01(t)) ?? { x: 0, y: 0 };

// ---------------- code snippet (production: the FR1-021 block via Shiki) ----------------
type Tok = [string, string];
const K = '#c792ea', F = '#82aaff', S = '#c3e88d', P = '#89ddff', T = '#e6ecff', C = '#6b7a99';
const CODE: Tok[][] = [
  [['channel', T], ['.', P], ['consume', F], ['(', P], ["'orders'", S], [', ', P], ['async ', K], ['(msg) ', T], ['=>', K], [' {', P]],
  [['  const ', K], ['order ', T], ['= ', P], ['JSON', T], ['.', P], ['parse', F], ['(msg.content);', T]],
  [['  await ', K], ['chargeCard', F], ['(order);', T], ['    // the work', C]],
  [['  channel', T], ['.', P], ['ack', F], ['(msg);', T], ['        // then ack', C]],
  [['});', P]],
];

export const Explainer: React.FC<{ captions: boolean }> = ({ captions }) => {
  const f = useCurrentFrame();
  const tl = timeline;
  const cam = camera(tl, f);
  const ms = (f * 1000) / FPS;

  // ----- build-in progress (buildPipeline) -----
  const pProducer = cueP(tl, 'producer', f, { dur: 30 });
  const pPipePB = cueP(tl, 'pipe_pb', f, { dur: 24, ease: 'inOut' });
  const pBroker = cueP(tl, 'broker', f, { dur: 30 });
  const pConsumer = cueP(tl, 'consumer', f, { dur: 30 });
  const pPipeBC = cueP(tl, 'pipe_bc', f, { dur: 24, ease: 'inOut' });

  // ----- broker open (zoomAndOpen) -----
  const open = cueP(tl, 'zoom', f, { dur: 36, delay: 8, ease: 'inOut' }) * (1 - cueP(tl, 'pullback', f, { dur: 28, ease: 'inOut' }));
  const awaitP = cueP(tl, 'await', f, { dur: 18 });
  const brokerHalfW = lerp(125, 340, open);

  // ----- consumer health (crash / redeliver) -----
  const crashF = cueF(tl, 'crash');
  const recoverF = cueF(tl, 'recover');
  const crashT = f - crashF;
  const recoverP = cueP(tl, 'recover', f, { dur: 26 });
  const gearRot = 4 * (f < crashF ? f : f < recoverF ? crashF : crashF + (f - recoverF));

  // ----- trays -----
  const ready = readyAt(sim, f);
  const parked = victimParked(sim, f);
  const slotMsgs: { m: Msg; tone: Tray['tone'] }[] = [
    ...(parked ? [{ m: sim.victim, tone: 'unacked' as const }] : []),
    ...ready.map((m) => ({ m, tone: 'ready' as const })),
  ];
  const trays: Tray[] = [0, 1, 2, 3].map((k) => {
    const s = slotMsgs[k];
    if (!s) return { tone: 'empty', enter: 0 };
    const since = s.tone === 'unacked' ? f - sim.crash : f - s.m.arrive;
    return { tone: s.tone, label: s.m.label, enter: clamp01(since / 12) };
  });
  const overflow = Math.max(0, slotMsgs.length - 4);

  // ----- cards on pipes -----
  const cards: React.ReactNode[] = [];
  const pulses: React.ReactNode[] = [];
  let eat = 0;
  let emit = 0;
  for (const m of sim.msgs) {
    emit = Math.max(emit, interpolate(f - m.spawn, [0, 3, 14], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
    if (f >= m.spawn && f < m.arrive) {
      const t = (f - m.spawn) / T_PB;
      const pt = at(PB, PB_LEN, ease(t));
      const o = clamp01((anchor.broker.x - brokerHalfW - 60 - pt.x) / 40) * clamp01((f - m.spawn) / 4);
      cards.push(<MessageCard key={`pb${m.i}`} x={pt.x} y={pt.y - 4} label={m.label} tone="neutral" s={lerp(0.5, 0.78, clamp01(t * 3))} o={o} />);
    }
    m.deliveries.forEach((d, j) => {
      const isVictimFirst = m.victim && j === 0;
      const arriveC = d + T_BC;
      if (f >= d && f < arriveC) {
        const pt = at(BC, BC_LEN, ease((f - d) / T_BC));
        const o = clamp01((pt.x - (anchor.broker.x + brokerHalfW + 60)) / 40);
        cards.push(<MessageCard key={`bc${m.i}-${j}`} x={pt.x} y={pt.y - 4} label={m.label} tone="amber" s={0.78} o={o} />);
      }
      // at the consumer: shrinks in while worked on
      const end = isVictimFirst ? sim.crash : m.ackStart ?? arriveC + PROC;
      if (f >= arriveC && f < end + (isVictimFirst ? 10 : 6)) {
        const k = clamp01((f - arriveC) / Math.max(1, end - arriveC));
        const done = f >= end;
        const tone: Tone = isVictimFirst && done ? 'red' : done ? 'green' : 'amber';
        const fade = done ? 1 - clamp01((f - end) / (isVictimFirst ? 10 : 6)) : 1;
        cards.push(
          <MessageCard key={`c${m.i}-${j}`} x={anchor.consumer.x} y={anchor.consumer.y - 150 + 18 * k} label={m.label} tone={tone} s={lerp(1, 0.86, k) * (isVictimFirst && done ? 1 + 0.4 * (1 - fade) : 1)} o={fade} />,
        );
        eat = Math.max(eat, interpolate(f - arriveC, [0, 4, PROC + 6], [0, 1, 0], { extrapolateRight: 'clamp' }));
      }
    });
    if (m.ackStart !== undefined && m.ackArrive !== undefined && f >= m.ackStart && f < m.ackArrive + 8) {
      const t = (f - m.ackStart) / T_ACK;
      const pt = at(BC, BC_LEN, 1 - ease(Math.min(1, t)));
      const big = m.victim ? 1.8 : 1;
      const o = f < m.ackArrive ? 1 : 1 - (f - m.ackArrive) / 8;
      pulses.push(
        <g key={`ack${m.i}`} opacity={o}>
          <circle cx={pt.x} cy={pt.y} r={13 * big} fill={color.green} opacity={0.35} filter="url(#softglow)" />
          <circle cx={pt.x} cy={pt.y} r={6 * big} fill={color.green} filter="url(#glow)" />
        </g>,
      );
    }
  }
  const ackFlash = interpolate(f - (sim.victim.ackArrive ?? 0), [0, 4, 24], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // ----- counters -----
  const unacked = sim.msgs.filter((m) => m.deliveries[0] !== undefined && m.deliveries[0] <= f && f < (m.ackArrive ?? Infinity)).length;
  const inQueue = ready.length + unacked;
  const dCount = deliveryCount(sim, f);
  const hudP = cueP(tl, 'counters', f, { dur: 18 }) * (1 - cueP(tl, 'title_lost', f, { dur: 14 }));

  // ----- dims for the recap -----
  const recapP = cueP(tl, 'title_lost', f, { dur: 24, ease: 'inOut' });
  const worldO = lerp(1, 0.5, recapP);
  const flowO = (pPipeBC > 0 ? 1 : 0) * (1 - open * 0.8);

  return (
    <AbsoluteFill style={{ backgroundColor: color.bg }}>
      {timeline.scenes.map((s) => (
        <Sequence key={s.id} from={s.audioFrom} layout="none">
          <Audio src={staticFile(s.audio)} />
        </Sequence>
      ))}
      <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ position: 'absolute' }}>
        <Defs />
        <defs>
          <radialGradient id="bgLight" cx="0.5" cy="0.18" r="0.75">
            <stop offset="0" stopColor={color.bgTop} />
            <stop offset="1" stopColor={color.bg} />
          </radialGradient>
          <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke={color.grid} strokeWidth={1} />
          </pattern>
          <pattern id="dots" width="120" height="120" patternUnits="userSpaceOnUse">
            <circle cx="60" cy="60" r="1.6" fill="rgba(148,163,184,0.16)" />
          </pattern>
          <radialGradient id="vignette" cx="0.5" cy="0.5" r="0.72">
            <stop offset="0.55" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.72" />
          </radialGradient>
        </defs>
        <rect width={WIDTH} height={HEIGHT} fill="url(#bgLight)" />

        {/* far layer: parallax at 40% of the camera move */}
        <g transform={cameraTransform({ ...cam, scale: 1 + (cam.scale - 1) * 0.4, cx: lerp(WIDTH / 2, cam.cx, 0.4), cy: lerp(HEIGHT / 2, cam.cy, 0.4) })}>
          <rect x={-2000} y={-2000} width={6000} height={5000} fill="url(#dots)" />
        </g>

        <g transform={cameraTransform(cam)} opacity={worldO}>
          <rect x={-2000} y={-2000} width={6000} height={5000} fill="url(#grid)" />
          {/* floor reflection line */}
          <ellipse cx={960} cy={745} rx={760} ry={26} fill="#1b2a55" opacity={0.35 * pBroker} filter="url(#softglow)" />

          {/* pipes */}
          <path d={PB} fill="none" stroke="#24345f" strokeWidth={10} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - pPipePB} />
          <path d={BC} fill="none" stroke="#24345f" strokeWidth={10} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - pPipeBC} />
          <g opacity={flowO * 0.9}>
            <path d={PB} fill="none" stroke={color.producer} strokeWidth={3} strokeDasharray="4 22" strokeDashoffset={-f * 2.2} strokeLinecap="round" opacity={0.6} />
            <path
              d={BC}
              fill="none"
              stroke={crashT >= 0 && recoverP < 1 ? color.red : color.broker}
              strokeWidth={3}
              strokeDasharray="4 22"
              strokeDashoffset={crashT >= 0 && recoverP < 1 ? -crashF * 2.2 : -f * 2.2}
              strokeLinecap="round"
              opacity={0.6}
            />
          </g>

          <g transform={`translate(${anchor.producer.x} ${anchor.producer.y})`} opacity={1 - 0.85 * open}>
            <ProducerRack p={pProducer} frame={f} pulse={emit} />
          </g>
          <g transform={`translate(${anchor.consumer.x} ${anchor.consumer.y})`} opacity={1 - 0.85 * open}>
            <ConsumerWorker p={pConsumer} frame={f} crashT={crashT} recoverP={recoverP} eat={eat} gearRot={gearRot} />
            {recoverP > 0 && recoverP < 1 ? (
              <circle r={120 + 120 * recoverP} fill="none" stroke={color.green} strokeWidth={4} opacity={1 - recoverP} />
            ) : null}
          </g>
          <g transform={`translate(${anchor.broker.x} ${anchor.broker.y})`}>
            <BrokerCabinet p={pBroker} open={open} frame={f} trays={trays} overflow={overflow} awaitP={awaitP} />
            {ackFlash > 0 ? <rect x={-brokerHalfW} y={-150} width={brokerHalfW * 2} height={300} rx={22} fill="none" stroke={color.green} strokeWidth={6} opacity={ackFlash} filter="url(#glow)" /> : null}
            <g opacity={awaitP * open * (parked ? 1 : 0)} transform="translate(-243 82)">
              <circle cx={-52} cy={-6} r={6} fill={color.amber} opacity={0.5 + 0.5 * Math.sin(f / 5)} />
              <text x={-40} y={0} fontFamily={font.sans} fontWeight={600} fontSize={17} fill={color.amber}>
                awaiting ack
              </text>
            </g>
          </g>
          {cards}
          {pulses}
          {crashShards(tl, f).map((s, i) => (
            <polygon key={i} points={s.pts} transform={`translate(${s.x} ${s.y}) rotate(${s.rot})`} fill={s.hue} opacity={s.opacity} />
          ))}
        </g>

        {/* ambient dust + vignette */}
        {dust(f).map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={d.r} fill="#9fb4ff" opacity={d.o} />
        ))}
        <rect width={WIDTH} height={HEIGHT} fill="url(#vignette)" />
        <rect width={WIDTH} height={HEIGHT} fill={color.red} opacity={interpolate(crashT, [0, 2, 12], [0, 0.16, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} />

        <Question tl={tl} f={f} />
        <Recap tl={tl} f={f} />
        <Hud o={hudP} inQueue={inQueue} dCount={dCount} f={f} />
        <CodePanel tl={tl} f={f} />

        {/* persistent chrome: series kicker and the AI notice on every frame (FR2-020) */}
        <text x={80} y={70} fontFamily={font.sans} fontWeight={600} fontSize={20} letterSpacing={4} fill={color.muted}>
          MESSAGE QUEUES · PART 2
        </text>
        <g transform="translate(1840 70)">
          <rect x={-150} y={-24} width={150} height={34} rx={17} fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.14)" />
          <text x={-75} y={-1} textAnchor="middle" fontFamily={font.sans} fontWeight={600} fontSize={17} fill={color.muted}>
            AI-generated
          </text>
        </g>
      </svg>
      {captions ? <Captions ms={ms} /> : null}
    </AbsoluteFill>
  );
};

// ---------------- opening question (writeTitle / indicate / dockTitle) ----------------
const hookWords = wordsOf(storyboard.scenes[0]!.spoken_text);
const Question: React.FC<{ tl: Timeline; f: number }> = ({ tl, f }) => {
  const dock = cueP(tl, 'q_dock', f, { dur: 30, ease: 'inOut' });
  const gone = cueP(tl, 'title_lost', f, { dur: 16 });
  const crashWord = cueP(tl, 'q_crash', f, { dur: 10 });
  const sinceCrash = f - cueF(tl, 'q_crash');
  const words = tl.words.filter((w) => w.sceneId === 'hook');
  const lines = [hookWords.slice(0, 5), hookWords.slice(5)];
  const y = lerp(500, 104, dock);
  const s = lerp(1, 0.4, dock);
  let idx = 0;
  return (
    <g transform={`translate(960 ${y - 30 * gone}) scale(${s})`} opacity={1 - gone}>
      {lines.map((line, li) => (
        <text key={li} y={li === 0 ? -40 : 72} textAnchor="middle" fontFamily={font.sans} fontWeight={700} fontSize={92} letterSpacing={-1}>
          {line.map((w) => {
            const i = idx++;
            const wordMs = words[i]?.startMs ?? 0;
            const t = ramp(f, Math.floor((wordMs * FPS) / 1000) - 4, 14);
            const isCrash = i === hookWords.length - 1;
            const fill = isCrash && crashWord > 0 ? `rgb(255,${Math.round(lerp(237, 77, crashWord))},${Math.round(lerp(247, 94, crashWord))})` : color.ink;
            const jitter = isCrash && sinceCrash >= 0 && sinceCrash < 10 ? Math.sin(sinceCrash * 7) * 6 : 0;
            return (
              <tspan key={i} dx={jitter} fill={fill} fillOpacity={clamp01((t - 0.35) / 0.65)} stroke={fill} strokeWidth={2} strokeOpacity={t} strokeDasharray={600} strokeDashoffset={600 * (1 - t)}>
                {w + ' '}
              </tspan>
            );
          })}
        </text>
      ))}
      <rect x={-260} y={118} width={520 * cueP(tl, 'q_dock', f, { dur: 30, delay: 16 })} height={6} rx={3} fill={color.broker} opacity={0.9} />
    </g>
  );
};

// ---------------- recap ----------------
const Recap: React.FC<{ tl: Timeline; f: number }> = ({ tl, f }) => {
  const words = tl.words.filter((w) => w.sceneId === 'recap').slice(0, 3);
  const chips = [
    { id: 'chip_ack', text: 'ack after the work', c: color.green, x: -250 },
    { id: 'chip_survive', text: 'unacked = redelivered', c: color.amber, x: 250 },
  ];
  if (f < cueF(tl, 'title_lost') - 6) return null;
  return (
    <g transform="translate(960 210)">
      <text textAnchor="middle" fontFamily={font.sans} fontWeight={700} fontSize={104} letterSpacing={-1}>
        {words.map((w, i) => {
          const t = ramp(f, Math.floor((w.startMs * FPS) / 1000) - 4, 14);
          return (
            <tspan key={i} fill={i === 2 ? color.green : color.ink} fillOpacity={clamp01((t - 0.3) / 0.7)} stroke={i === 2 ? color.green : color.ink} strokeWidth={2} strokeOpacity={t} strokeDasharray={700} strokeDashoffset={700 * (1 - t)}>
              {w.text + ' '}
            </tspan>
          );
        })}
      </text>
      {chips.map((c) => {
        const p = cueP(tl, c.id, f, { dur: 20 });
        return (
          <g key={c.id} transform={`translate(${c.x} ${110 + 24 * (1 - p)})`} opacity={p}>
            <rect x={-215} y={-34} width={430} height={68} rx={34} fill="rgba(10,16,34,0.85)" stroke={c.c} strokeWidth={2.5} filter="url(#glow)" />
            <circle cx={-178} cy={0} r={15} fill={c.c} />
            <path d="M -185 0 L -179 6 L -170 -6" fill="none" stroke="#06101f" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
            <text x={-150} y={10} fontFamily={font.mono} fontSize={28} fill={color.ink}>
              {c.text}
            </text>
          </g>
        );
      })}
    </g>
  );
};

// ---------------- live counters ----------------
const Hud: React.FC<{ o: number; inQueue: number; dCount: number; f: number }> = ({ o, inQueue, dCount, f }) => {
  if (o <= 0) return null;
  const rows: { k: string; v: number; c: string; hist: (g: number) => number }[] = [
    { k: 'in_queue', v: inQueue, c: color.broker, hist: (g) => readyAt(sim, g).length + sim.msgs.filter((m) => m.deliveries[0] !== undefined && m.deliveries[0] <= g && g < (m.ackArrive ?? Infinity)).length },
    { k: 'delivery_count', v: dCount, c: dCount > 1 ? color.amber : color.ink, hist: (g) => deliveryCount(sim, g) },
  ];
  return (
    <g transform={`translate(1460 ${130 - 16 * (1 - o)})`} opacity={o}>
      <rect x={0} y={0} width={380} height={140} rx={18} fill="rgba(12,20,44,0.78)" stroke="rgba(79,140,255,0.45)" strokeWidth={2} filter="url(#shadow)" />
      {rows.map((r, i) => {
        // roll the number in when it changed within the last 10 frames
        let changed = -1;
        for (let g = 0; g < 10; g++) if (r.hist(f - g) !== r.hist(f - g - 1)) { changed = g; break; }
        const roll = changed >= 0 ? ramp(changed, 0, 10) : 1;
        return (
          <g key={r.k} transform={`translate(28 ${52 + i * 54})`}>
            <text fontFamily={font.mono} fontSize={26} fill={color.muted}>{r.k}</text>
            <clipPath id={`roll${i}`}>
              <rect x={260} y={-30} width={90} height={40} />
            </clipPath>
            <g clipPath={`url(#roll${i})`}>
              <text x={330} y={22 * (1 - roll)} textAnchor="end" fontFamily={font.mono} fontWeight={700} fontSize={32} fill={r.c} opacity={roll}>{r.v}</text>
            </g>
          </g>
        );
      })}
    </g>
  );
};

// ---------------- code panel (codeHighlight) ----------------
const CodePanel: React.FC<{ tl: Timeline; f: number }> = ({ tl, f }) => {
  const inP = cueP(tl, 'split', f, { dur: 26 });
  if (inP <= 0) return null;
  const dockP = cueP(tl, 'pullback', f, { dur: 30, ease: 'inOut' });
  const outP = cueP(tl, 'title_lost', f, { dur: 16 });
  const x = lerp(1030 + 120 * (1 - inP), 80, dockP);
  const y = lerp(300, 128, dockP);
  const s = lerp(1, 0.6, dockP);
  const workP = cueP(tl, 'work_line', f, { dur: 8 }) * (1 - cueP(tl, 'ack_line', f, { dur: 8 }));
  const ackP = cueP(tl, 'ack_line', f, { dur: 8 });
  const ackPulse = interpolate(f - cueF(tl, 'ack'), [0, 3, 20], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const start = cueF(tl, 'split') + 8;
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity={inP * (1 - outP)}>
      <rect x={0} y={0} width={830} height={400} rx={20} fill={color.codeBg} stroke="rgba(130,170,255,0.25)" strokeWidth={2} filter="url(#shadow)" />
      <rect x={0} y={0} width={830} height={52} rx={20} fill="#141c36" />
      <rect x={0} y={32} width={830} height={20} fill="#141c36" />
      {['#ff5f57', '#febc2e', '#28c840'].map((c, i) => (
        <circle key={c} cx={30 + i * 24} cy={26} r={7} fill={c} />
      ))}
      <text x={415} y={33} textAnchor="middle" fontFamily={font.mono} fontSize={18} fill={color.muted}>consumer.js</text>
      {/* highlight bars */}
      <rect x={14} y={78 + 2 * 56 - 6} width={802} height={48} rx={8} fill={color.amber} opacity={0.16 * workP} />
      <rect x={14} y={78 + 3 * 56 - 6} width={802} height={48} rx={8} fill={color.green} opacity={0.2 * ackP + 0.3 * ackPulse} stroke={color.green} strokeOpacity={ackP * 0.8 + ackPulse * 0.2} strokeWidth={2} filter={ackPulse > 0 ? 'url(#glow)' : undefined} />
      {CODE.map((line, li) => {
        const lineStart = start + li * 6;
        const total = line.reduce((a, [t]) => a + t.length, 0);
        let shown = Math.floor(clamp01((f - lineStart) / 10) * total);
        const dim = ackP > 0 && li !== 3 ? 0.55 : workP > 0 && li !== 2 ? 0.6 : 1;
        return (
          <text key={li} x={40} y={78 + li * 56 + 26} fontFamily={font.mono} fontSize={26} opacity={dim} xmlSpace="preserve">
            <tspan fill="#46527a">{String(li + 1).padStart(2, ' ')}  </tspan>
            {line.map(([t, c], ti) => {
              const part = t.slice(0, Math.max(0, shown));
              shown -= t.length;
              return part ? <tspan key={ti} fill={c}>{part}</tspan> : null;
            })}
          </text>
        );
      })}
    </g>
  );
};

// ---------------- burned-in captions (the clean master uses the .vtt sidecar) ----------------
const Captions: React.FC<{ ms: number }> = ({ ms }) => {
  const cue = timeline.captions.find((c) => ms >= c.startMs && ms < c.endMs);
  if (!cue) return null;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 54, display: 'flex', justifyContent: 'center' }}>
      <div style={{ background: 'rgba(4,7,16,0.78)', borderRadius: 14, padding: '10px 26px', textAlign: 'center', whiteSpace: 'nowrap', fontFamily: font.sans, fontWeight: 600, fontSize: 42, lineHeight: 1.28, color: '#f4f7ff' }}>
        {cue.lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
};
