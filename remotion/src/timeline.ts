// Pure timing model (VIDEO-PIPELINE.md §8): storyboard + measured audio + theme -> frames.
import { FPS, holdMs, paceMs, timing } from './theme';
import { type Recipe, type Scene, wordsOf } from './storyboard';

export type WordMark = { index: number; text: string; start_ms: number; end_ms: number };
export type NarrationScene = { id: string; audio: string; audio_ms: number; marks: WordMark[] };

export type TimedCue = { id: string; scene: string; do: Recipe; frame: number; frames: number };
export type TimedScene = { id: string; audio: string; startMs: number; startFrame: number; frames: number; audioFrom: number };
export type Caption = { startMs: number; endMs: number; lines: string[] };
export type Timeline = {
  totalFrames: number;
  scenes: TimedScene[];
  cues: Record<string, TimedCue>;
  captions: Caption[];
  words: { sceneId: string; text: string; startMs: number; endMs: number }[];
};

const msToFrame = (ms: number): number => Math.round((ms * FPS) / 1000);

export function buildTimeline(scenes: Scene[], narration: NarrationScene[]): Timeline {
  let cursorMs = timing.openingMs;
  const timed: TimedScene[] = [];
  const cues: Record<string, TimedCue> = {};
  const words: Timeline['words'] = [];

  scenes.forEach((scene, s) => {
    const audio = narration[s];
    if (!audio || audio.id !== scene.id) throw new Error(`narration missing for scene ${scene.id}; run npm run narrate`);
    if (audio.marks.length !== wordsOf(scene.spoken_text).length)
      throw new Error(`narration for ${scene.id} is stale; run npm run narrate`);
    const startMs = cursorMs;
    const sceneMs = timing.padInMs + audio.audio_ms + timing.padOutMs + holdMs[scene.hold_after];
    timed.push({ id: scene.id, audio: audio.audio, startMs, startFrame: msToFrame(startMs), frames: 0, audioFrom: msToFrame(startMs + timing.padInMs) });

    for (const m of audio.marks)
      words.push({ sceneId: scene.id, text: m.text, startMs: startMs + timing.padInMs + m.start_ms, endMs: startMs + timing.padInMs + m.end_ms });

    for (const cue of scene.cues) {
      const mark = audio.marks[cue.word];
      if (!mark) throw new Error(`cue ${cue.id} targets word ${cue.word} outside scene ${scene.id}`);
      if (cues[cue.id]) throw new Error(`duplicate cue id ${cue.id}`);
      const wordMs = startMs + timing.padInMs + mark.start_ms;
      cues[cue.id] = {
        id: cue.id,
        scene: scene.id,
        do: cue.do,
        frame: Math.max(0, Math.floor((wordMs * FPS) / 1000) - timing.leadFrames),
        frames: Math.round((paceMs[cue.pace] * FPS) / 1000),
      };
    }
    cursorMs += sceneMs;
  });

  // Start frames come from absolute ms, so lengths never drift (§8).
  const totalFrames = msToFrame(cursorMs);
  timed.forEach((t, i) => {
    t.frames = (timed[i + 1]?.startFrame ?? totalFrames) - t.startFrame;
  });

  return { totalFrames, scenes: timed, cues, captions: buildCaptions(words), words };
}

const wrap = (words: string[], max = 42): string[] => {
  const lines: string[] = [];
  for (const w of words) {
    const cur = lines.at(-1);
    if (cur !== undefined && (cur + ' ' + w).length <= max) lines[lines.length - 1] = cur + ' ' + w;
    else lines.push(w);
  }
  if (lines.length !== 2) return lines;
  // Balance two lines so no one-word orphan hangs on line 2.
  // Score = longer line, with a bonus for breaking after a comma.
  const score = (pair: string[]) => Math.max(...pair.map((l) => l.length)) - (pair[0]?.endsWith(',') ? 10 : 0);
  let best = lines;
  for (let i = 1; i < words.length; i++) {
    const pair = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    if (pair.every((l) => l.length <= max) && score(pair) < score(best)) best = pair;
  }
  return best;
};

// Captions break at sentence ends, 42 characters per line, 2 lines (§8).
function buildCaptions(words: Timeline['words']): Caption[] {
  const out: Caption[] = [];
  let group: Timeline['words'] = [];
  const flush = () => {
    const first = group[0];
    const last = group.at(-1);
    if (!first || !last) return;
    out.push({ startMs: first.startMs, endMs: last.endMs + 250, lines: wrap(group.map((g) => g.text)) });
    group = [];
  };
  for (const w of words) {
    const prev = group.at(-1);
    const tooLong = wrap([...group, w].map((g) => g.text)).length > 2;
    if (prev && (prev.sceneId !== w.sceneId || tooLong || w.endMs - (group[0]?.startMs ?? 0) > 7000)) {
      // Prefer breaking after the last comma so no short orphan is left over.
      const comma = group.findLastIndex((g, i) => i > 0 && i < group.length - 1 && /,$/.test(g.text));
      const rest = prev.sceneId === w.sceneId && comma > 0 ? group.splice(comma + 1) : [];
      flush();
      group = rest;
    }
    group.push(w);
    if (/[.?!]$/.test(w.text)) flush();
  }
  flush();
  // Never overlap the next cue.
  out.forEach((c, i) => {
    const next = out[i + 1];
    if (next && c.endMs > next.startMs) c.endMs = next.startMs;
  });
  return out;
}

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');
const vttTime = (ms: number) =>
  `${pad(ms / 3_600_000)}:${pad((ms / 60_000) % 60)}:${pad((ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;

export const toWebVtt = (captions: Caption[]): string =>
  'WEBVTT\n\n' +
  captions.map((c, i) => `${i + 1}\n${vttTime(c.startMs)} --> ${vttTime(c.endMs)}\n${c.lines.join('\n')}\n`).join('\n');
