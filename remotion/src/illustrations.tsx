// Inline-SVG illustrations, drawn in local coordinates around (0,0). All props are numbers
// derived from the frame, so every component is a pure function of time.
import React from 'react';
import { interpolate, random } from 'remotion';
import { color, font } from './theme';
import { clamp01, lerp } from './motion';

/** Stroke draw-on helper: pathLength=1 lets any shape draw on with one progress value. */
const draw = (p: number) => ({ pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - clamp01(p) });

export const Defs: React.FC = () => (
  <defs>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="7" result="b" />
      <feMerge>
        <feMergeNode in="b" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
    <filter id="softglow" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="18" />
    </filter>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="18" stdDeviation="16" floodColor="#000" floodOpacity="0.55" />
    </filter>
    <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#1c2645" />
      <stop offset="1" stopColor="#0e152b" />
    </linearGradient>
    <linearGradient id="brokerFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#173170" />
      <stop offset="1" stopColor="#0b1838" />
    </linearGradient>
    <radialGradient id="halo">
      <stop offset="0" stopColor="#fff" stopOpacity="1" />
      <stop offset="1" stopColor="#fff" stopOpacity="0" />
    </radialGradient>
  </defs>
);

/** Soft light pool behind an object (depth + light). */
export const Halo: React.FC<{ r: number; c: string; o: number }> = ({ r, c, o }) => (
  <circle r={r} fill={c} opacity={o} filter="url(#softglow)" />
);

const Label: React.FC<{ y: number; text: string; o: number; c?: string }> = ({ y, text, o, c = color.ink }) => (
  <text y={y} textAnchor="middle" fontFamily={font.sans} fontWeight={600} fontSize={30} letterSpacing={1} fill={c} opacity={o}>
    {text}
  </text>
);

// ---------------- Producer: a server rack ----------------
export const ProducerRack: React.FC<{ p: number; frame: number; pulse: number }> = ({ p, frame, pulse }) => {
  const fillO = clamp01((p - 0.45) / 0.55);
  return (
    <g>
      <Halo r={170} c={color.producer} o={(0.12 + 0.18 * pulse) * fillO} />
      <g filter="url(#shadow)" opacity={fillO}>
        <rect x={-95} y={-125} width={190} height={250} rx={18} fill="url(#metal)" />
      </g>
      <rect x={-95} y={-125} width={190} height={250} rx={18} fill="none" stroke={color.producer} strokeWidth={3} {...draw(p)} />
      {[0, 1, 2, 3].map((u) => {
        const y = -100 + u * 56;
        const up = clamp01((p - 0.3 - u * 0.12) / 0.3);
        return (
          <g key={u} opacity={up} transform={`translate(0 ${(1 - up) * 10})`}>
            <rect x={-74} y={y} width={148} height={42} rx={7} fill="#141d38" stroke="#2c3962" strokeWidth={1.5} />
            {[0, 1, 2, 3, 4].map((v) => (
              <rect key={v} x={-60 + v * 12} y={y + 12} width={5} height={18} rx={2} fill="#2c3962" />
            ))}
            {[0, 1].map((l) => {
              const on = Math.sin(frame / (4 + u + l * 3) + u * 2 + l) > 0.1;
              return <circle key={l} cx={44 + l * 16} cy={y + 21} r={4.5} fill={on ? (l ? color.producer : color.green) : '#26304f'} />;
            })}
          </g>
        );
      })}
      <Label y={170} text="Producer" o={fillO} />
    </g>
  );
};

// ---------------- Broker: cabinet of trays that opens into a queue ----------------
export type Tray = { label?: string; tone: 'empty' | 'ready' | 'unacked'; enter: number };

export const BrokerCabinet: React.FC<{
  p: number;
  open: number;
  frame: number;
  trays: Tray[];
  overflow: number;
  awaitP: number;
}> = ({ p, open, frame, trays, overflow, awaitP }) => {
  const fillO = clamp01((p - 0.4) / 0.6);
  const w = lerp(250, 680, open);
  const h = lerp(300, 200, open);
  const breathe = 0.5 + 0.5 * Math.sin(frame / 14);
  return (
    <g>
      <Halo r={lerp(190, 300, open)} c={color.broker} o={(0.2 + 0.08 * breathe) * fillO * (1 - 0.7 * open)} />
      <g filter="url(#shadow)" opacity={fillO}>
        <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={22} fill="url(#brokerFill)" />
      </g>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={22} fill="none" stroke={color.broker} strokeWidth={3.5} {...draw(p)} filter="url(#glow)" />
      {/* header strip */}
      <g opacity={fillO * (1 - open)}>
        <rect x={-w / 2 + 18} y={-h / 2 + 16} width={w - 36} height={22} rx={6} fill="#20408f" />
        {[0, 1, 2].map((i) => (
          <circle key={i} cx={-w / 2 + 34 + i * 16} cy={-h / 2 + 27} r={4} fill={i === 0 ? color.broker : '#4b67b0'} />
        ))}
      </g>
      <g opacity={open} transform={`translate(0 ${-h / 2 + 30})`}>
        <text x={-w / 2 + 28} y={0} fontFamily={font.mono} fontSize={15} fill="#9db8ff" letterSpacing={1}>
          queue: orders
        </text>
      </g>
      {trays.map((t, k) => {
        const tx = lerp(0, -243 + k * 162, open);
        const ty = lerp(95 - k * 50, 16, open);
        const tw = lerp(190, 148, open);
        const th = lerp(36, 82, open);
        const show = clamp01((p - 0.5 - k * 0.1) / 0.3);
        const tone = t.tone;
        const stroke = tone === 'unacked' ? color.amber : tone === 'ready' ? color.broker : '#2a3b6e';
        const fill = tone === 'unacked' ? 'rgba(255,181,71,0.16)' : tone === 'ready' ? 'rgba(79,140,255,0.22)' : 'rgba(20,32,70,0.6)';
        const pop = tone === 'empty' ? 0 : interpolate(t.enter, [0, 0.5, 1], [0, 1, 0]);
        return (
          <g key={k} transform={`translate(${tx} ${ty})`} opacity={show}>
            {tone === 'unacked' ? <Halo r={70 + 20 * awaitP} c={color.amber} o={0.25 + 0.35 * awaitP * breathe} /> : null}
            <rect x={-tw / 2} y={-th / 2} width={tw} height={th} rx={lerp(8, 12, open)} fill={fill} stroke={stroke} strokeWidth={2.5 + pop * 3} filter={tone === 'empty' ? undefined : 'url(#glow)'} />
            {t.label ? (
              <text y={6} textAnchor="middle" fontFamily={font.mono} fontSize={13} fill={tone === 'unacked' ? '#ffe2b0' : '#dbe6ff'} opacity={open}>
                {t.label}
              </text>
            ) : null}
            {tone === 'ready' && open < 0.5 ? (
              <rect x={-tw / 2 + 12} y={-4} width={tw - 24} height={8} rx={4} fill={color.broker} opacity={0.75 * (1 - open * 2)} />
            ) : null}
            {tone === 'unacked' && open < 0.5 ? (
              <rect x={-tw / 2 + 12} y={-4} width={tw - 24} height={8} rx={4} fill={color.amber} opacity={1 - open * 2} />
            ) : null}
          </g>
        );
      })}
      {overflow > 0 ? (
        <text x={lerp(104, 312, open)} y={lerp(-96, -64, open)} textAnchor="end" fontFamily={font.mono} fontSize={lerp(20, 17, open)} fill="#9db8ff">
          +{overflow}
        </text>
      ) : null}
      <Label y={lerp(205, 150, open)} text="Broker" o={fillO * (1 - open)} c="#cfe0ff" />
    </g>
  );
};

// ---------------- Consumer: a worker with a gear ----------------
const gearPath = (() => {
  const teeth = 10;
  const pts: string[] = [];
  for (let i = 0; i < teeth * 2; i++) {
    const r = i % 2 === 0 ? 34 : 26;
    const a0 = (i / (teeth * 2)) * Math.PI * 2;
    const a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2;
    pts.push(`${(Math.cos(a0) * r).toFixed(2)},${(Math.sin(a0) * r).toFixed(2)}`, `${(Math.cos(a1) * r).toFixed(2)},${(Math.sin(a1) * r).toFixed(2)}`);
  }
  return `M ${pts.join(' L ')} Z`;
})();

export const ConsumerWorker: React.FC<{
  p: number;
  frame: number;
  crashT: number; // frames since crash (negative = not yet)
  recoverP: number; // 0..1 recovery
  eat: number; // 0..1 pulse when a message is consumed
  gearRot: number;
}> = ({ p, frame, crashT, recoverP, eat, gearRot }) => {
  const crashed = crashT >= 0 && recoverP < 1;
  const redness = crashT < 0 ? 0 : clamp01(crashT / 6) * (1 - recoverP);
  const green = recoverP;
  const tone = green > 0.01 ? mix(color.red, color.green, green) : redness > 0 ? mix(color.consumer, color.red, redness) : color.consumer;
  const fillO = clamp01((p - 0.45) / 0.55);
  const glitch = crashT >= 0 && crashT < 16;
  const slices = glitch ? 7 : 1;
  const body = (dx: number, c: string, o: number, key: string) => (
    <g key={key} transform={`translate(${dx} 0)`} opacity={o}>
      <g filter="url(#shadow)" opacity={fillO}>
        <rect x={-100} y={-115} width={200} height={230} rx={22} fill="url(#metal)" />
      </g>
      <rect x={-100} y={-115} width={200} height={230} rx={22} fill="none" stroke={c} strokeWidth={3} {...draw(p)} />
      <g opacity={fillO}>
        <rect x={-72} y={-92} width={144} height={58} rx={10} fill="#0b1226" stroke="#2b3760" strokeWidth={1.5} />
        {/* status bars */}
        {[0, 1, 2].map((i) => (
          <rect key={i} x={-58} y={-80 + i * 14} width={crashed ? 30 + i * 10 : 60 + 40 * Math.abs(Math.sin(frame / 9 + i))} height={7} rx={3.5} fill={c} opacity={0.75} />
        ))}
        <g transform={`translate(0 30) rotate(${gearRot})`}>
          <path d={gearPath} fill="none" stroke={c} strokeWidth={3} />
          <circle r={10} fill="none" stroke={c} strokeWidth={3} />
        </g>
        {crashed && crashT > 6 ? (
          <g transform="translate(0 30)" stroke={color.red} strokeWidth={7} strokeLinecap="round" opacity={clamp01((crashT - 6) / 6)}>
            <line x1={-24} y1={-24} x2={24} y2={24} />
            <line x1={24} y1={-24} x2={-24} y2={24} />
          </g>
        ) : null}
      </g>
    </g>
  );
  return (
    <g>
      <Halo r={175} c={tone} o={(0.1 + 0.25 * eat + 0.35 * redness + 0.3 * green * (1 - recoverP * 0.6)) * fillO} />
      {Array.from({ length: slices }, (_, s) => {
        if (!glitch) return <g key={s}>{body(0, tone, 1, 'main')}</g>;
        const y0 = -130 + (s * 260) / slices;
        const off = (random(`g${s}-${frame}`) - 0.5) * 50 * (1 - crashT / 16);
        return (
          <g key={s}>
            <clipPath id={`slice${s}`}>
              <rect x={-140} y={y0} width={280} height={260 / slices + 1} />
            </clipPath>
            <g clipPath={`url(#slice${s})`}>
              {body(off - 6, '#00e5ff', 0.55, 'c')}
              {body(off + 6, color.red, 0.75, 'r')}
              {body(off, tone, 1, 'm')}
            </g>
          </g>
        );
      })}
      <Label y={165} text="Consumer" o={fillO} c={redness > 0.5 ? '#ffb3bb' : color.ink} />
    </g>
  );
};

// ---------------- Message card ----------------
export type Tone = 'neutral' | 'amber' | 'green' | 'red';
const toneColor: Record<Tone, string> = { neutral: '#c9d4ff', amber: color.amber, green: color.green, red: color.red };

export const MessageCard: React.FC<{ x: number; y: number; label: string; tone: Tone; s: number; o: number }> = ({ x, y, label, tone, s, o }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`} opacity={o}>
    <rect x={-82} y={-21} width={164} height={42} rx={11} fill="#0e1730" stroke={toneColor[tone]} strokeWidth={2.2} filter="url(#glow)" />
    <text y={6} textAnchor="middle" fontFamily={font.mono} fontSize={16} fill={tone === 'neutral' ? '#e6ecff' : toneColor[tone]}>
      {label}
    </text>
  </g>
);

export function mix(a: string, b: string, t: number): string {
  const pa = hex(a);
  const pb = hex(b);
  const c = pa.map((v, i) => Math.round(lerp(v, pb[i] ?? v, clamp01(t))));
  return `rgb(${c.join(',')})`;
}
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
