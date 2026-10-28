// Deterministic message-flow schedule. Computed once from cue frames; every visual query is a
// pure lookup by frame, so any frame can be rendered in any order with the same pixels.
import type { Timeline } from './timeline';

export const T_PB = 24; // producer -> broker travel frames
export const T_BC = 20; // broker -> consumer travel frames
export const PROC = 9; // consumer work frames
export const T_ACK = 12; // ack pulse travel frames, consumer -> broker
const SERVICE = 12; // min frames between deliveries

export type Msg = {
  i: number;
  label: string;
  spawn: number;
  arrive: number;
  deliveries: number[]; // departure frames from the broker
  ackStart?: number;
  ackArrive?: number;
  victim: boolean;
};

export type Sim = {
  msgs: Msg[];
  crash: number;
  recoverAt: number;
  victim: Msg;
};

const cueFrame = (tl: Timeline, id: string): number => {
  const c = tl.cues[id];
  if (!c) throw new Error(`missing cue ${id}`);
  return c.frame;
};

export function buildSim(tl: Timeline): Sim {
  const stream = cueFrame(tl, 'stream');
  const fill = cueFrame(tl, 'fill');
  const drain = cueFrame(tl, 'drain');
  const crash = cueFrame(tl, 'crash');
  const recover = cueFrame(tl, 'recover');
  const redeliver = cueFrame(tl, 'redeliver');
  const ack = cueFrame(tl, 'ack');
  const end = tl.totalFrames;

  // Spawn schedule: steady, then a burst (queue fills), then sparse (queue drains), then a
  // trickle while the consumer is down (queue grows again), stopping at recovery.
  const spawns: number[] = [];
  for (let f = stream - T_PB + 2; f < recover; ) {
    spawns.push(f);
    f += f < fill - T_PB ? 16 : f < drain - 18 ? 3 : f < crash ? 30 : 64;
  }

  const msgs: Msg[] = spawns.map((spawn, i) => ({
    i,
    label: `{"order": ${1040 + i}}`,
    spawn,
    arrive: spawn + T_PB,
    deliveries: [],
    victim: false,
  }));

  // Normal deliveries until just before the crash.
  const lastNormal = crash - T_BC - PROC - 2;
  let free = stream;
  let k = 0;
  for (; k < msgs.length; k++) {
    const m = msgs[k]!;
    const d = Math.max(m.arrive, free);
    if (d > lastNormal) break;
    m.deliveries.push(d);
    m.ackStart = d + T_BC + PROC;
    m.ackArrive = m.ackStart + T_ACK;
    free = d + SERVICE;
  }

  // The victim: delivered so it reaches the consumer just before the crash, then never acked.
  const victim = msgs[k];
  if (!victim) throw new Error('no message left to be the victim');
  victim.victim = true;
  victim.deliveries.push(Math.max(victim.arrive, crash - T_BC - 3));

  // Redelivery after recovery; the ack pulse lands on the word "acknowledged".
  victim.deliveries.push(redeliver);
  victim.ackArrive = ack + 3;
  victim.ackStart = victim.ackArrive - T_ACK;

  // Everything that piled up drains after the ack.
  free = victim.ackArrive + 4;
  for (k += 1; k < msgs.length; k++) {
    const m = msgs[k]!;
    const d = Math.max(m.arrive, free);
    if (d > end) break;
    m.deliveries.push(d);
    m.ackStart = d + T_BC + PROC;
    m.ackArrive = m.ackStart + T_ACK;
    free = d + SERVICE + 4;
  }

  return { msgs, crash, recoverAt: recover, victim };
}

/** Messages waiting (ready) in the broker at frame f, oldest first. */
export const readyAt = (sim: Sim, f: number): Msg[] =>
  sim.msgs.filter((m) => {
    if (m.arrive > f) return false;
    const first = m.deliveries[0];
    return first === undefined || f < first;
  });

/** The victim is back in the broker, unacknowledged, from the crash until redelivery. */
export const victimParked = (sim: Sim, f: number): boolean =>
  f >= sim.crash && f < (sim.victim.deliveries[1] ?? Infinity);

export const deliveryCount = (sim: Sim, f: number): number => sim.victim.deliveries.filter((d) => d <= f).length;
