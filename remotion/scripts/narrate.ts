// Audio-first narration (CON2-3): synthesise each scene with macOS `say`, measure the real
// decoded duration, and estimate word timings. Writes public/audio/<scene>.wav and
// src/generated/narration.json, which the timeline reads.
//
// Word timing method (prototype only): find the speech span with ffmpeg silencedetect, then
// spread the scene's words across it in proportion to their spoken character count, with extra
// weight after commas and sentence ends for the pauses the voice makes. Error is typically
// ±100–250 ms per word; the production pipeline uses the TTS provider's word marks (§9.3).
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { storyboard, toSpeech, wordsOf } from '../src/storyboard';

const VOICE = 'Samantha';
const RATE = 190; // words per minute
const root = join(import.meta.dirname, '..');
const audioDir = join(root, 'public', 'audio');
const tmpDir = join(root, '.tmp');
mkdirSync(audioDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });
mkdirSync(join(root, 'src', 'generated'), { recursive: true });

const run = (cmd: string, args: string[]): string =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const durationMs = (file: string): number =>
  Math.round(
    Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).trim()) * 1000,
  );

// silencedetect reports on stderr; the file path is passed as $1, never interpolated.
const speechSpan = (file: string, totalMs: number): { start: number; end: number } => {
  const log = execFileSync(
    'sh',
    ['-c', 'ffmpeg -hide_banner -i "$1" -af silencedetect=noise=-45dB:d=0.04 -f null - 2>&1', 'sh', file],
    { encoding: 'utf8' },
  );
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]) * 1000);
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]) * 1000);
  const start = starts[0] !== undefined && starts[0] < 5 && ends[0] !== undefined ? ends[0] : 0;
  const lastStart = starts.at(-1);
  const end = lastStart !== undefined && lastStart > start && totalMs - lastStart < 1500 ? lastStart : totalMs;
  return { start: Math.round(start), end: Math.round(end) };
};

const pauseAfter = (word: string): number => (/[.?!]$/.test(word) ? 7 : /[,;:]$/.test(word) ? 4 : 0.6);

const out = {
  voice: VOICE,
  rate_wpm: RATE,
  method: 'say + silencedetect span + proportional character weights (estimate)',
  scenes: storyboard.scenes.map((scene) => {
    const aiff = join(tmpDir, `${scene.id}.aiff`);
    const wav = join(audioDir, `${scene.id}.wav`);
    run('say', ['-v', VOICE, '-r', String(RATE), '-o', aiff, toSpeech(scene.spoken_text)]);
    run('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiff, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
    const audio_ms = durationMs(wav);
    const span = speechSpan(wav, audio_ms);

    const written = wordsOf(scene.spoken_text);
    const weights = written.map((w) => toSpeech(w).replace(/[^A-Za-z0-9 ]/g, '').length + 1);
    const pauses = written.map(pauseAfter);
    pauses[pauses.length - 1] = 0;
    const total = weights.reduce((a, b) => a + b, 0) + pauses.reduce((a, b) => a + b, 0);
    const msPer = (span.end - span.start) / total;
    let cursor = span.start;
    const marks = written.map((text, index) => {
      const start_ms = Math.round(cursor);
      const end_ms = Math.round(cursor + (weights[index] ?? 0) * msPer);
      cursor = end_ms + (pauses[index] ?? 0) * msPer;
      return { index, text, start_ms, end_ms };
    });
    console.log(`${scene.id.padEnd(9)} ${String(audio_ms).padStart(5)} ms  speech ${span.start}-${span.end} ms`);
    return { id: scene.id, audio: `audio/${scene.id}.wav`, audio_ms, speech_ms: span, marks };
  }),
};

writeFileSync(join(root, 'src', 'generated', 'narration.json'), JSON.stringify(out, null, 2) + '\n');
rmSync(tmpDir, { recursive: true, force: true });
console.log(`total audio ${(out.scenes.reduce((a, s) => a + s.audio_ms, 0) / 1000).toFixed(2)} s`);
