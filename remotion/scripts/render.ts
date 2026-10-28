// Render pipeline for the prototype (VIDEO-PIPELINE.md §11.5):
//   Remotion H.264 + AAC  ->  FFmpeg two-pass loudnorm (-16 LUFS, TP -1.5)  ->  +faststart
// Usage:
//   npm run render                 full render: both MP4s, VTT, poster, contact sheet, report
//   npm run render -- stills 60 320   only render the listed frames to out/stills/
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import narration from '../src/generated/narration.json';
import { storyboard } from '../src/storyboard';
import { buildTimeline, toWebVtt } from '../src/timeline';

const root = join(import.meta.dirname, '..');
const out = join(root, 'out');
mkdirSync(out, { recursive: true });
const tl = buildTimeline(storyboard.scenes, narration.scenes);
const concurrency = Math.max(1, cpus().length - 2);
const t = () => performance.now();
const sec = (ms: number) => Math.round(ms / 100) / 10;

const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
// ffmpeg prints loudnorm stats on stderr; path args are passed positionally, never interpolated.
const runErr = (args: string[]) =>
  execFileSync('sh', ['-c', 'ffmpeg "$@" 2>&1', 'sh', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const t0 = t();
const serveUrl = await bundle({ entryPoint: join(root, 'src', 'index.ts') });
const bundleMs = t() - t0;

const comp = async (captions: boolean) =>
  selectComposition({ serveUrl, id: 'Explainer', inputProps: { captions } });

if (process.argv[2] === 'stills') {
  const dir = join(out, 'stills');
  mkdirSync(dir, { recursive: true });
  const composition = await comp(process.argv.includes('--captions'));
  for (const a of process.argv.slice(3).filter((x) => /^\d+$/.test(x))) {
    await renderStill({ serveUrl, composition, frame: Number(a), output: join(dir, `f${a}.png`), inputProps: composition.props });
    console.log(join(dir, `f${a}.png`));
  }
  process.exit(0);
}

const loudnorm = (input: string, output: string) => {
  const target = 'I=-16:TP=-1.5:LRA=11';
  const pass1 = runErr(['-hide_banner', '-i', input, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-']);
  const m = JSON.parse(pass1.slice(pass1.lastIndexOf('{'), pass1.lastIndexOf('}') + 1)) as Record<string, string>;
  const af = `loudnorm=${target}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-c:v', 'copy', '-af', af, '-ar', '48000', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output]);
};

const timings: Record<string, number> = { bundle_s: sec(bundleMs) };
for (const captions of [false, true]) {
  const composition = await comp(captions);
  const raw = join(out, captions ? '.raw-captions.mp4' : '.raw-clean.mp4');
  const s = t();
  await renderMedia({ serveUrl, composition, codec: 'h264', crf: 18, colorSpace: 'bt709', outputLocation: raw, inputProps: composition.props, concurrency });
  timings[captions ? 'render_captions_s' : 'render_clean_s'] = sec(t() - s);
  const l = t();
  loudnorm(raw, join(out, captions ? 'explainer.mp4' : 'explainer-clean.mp4'));
  timings[captions ? 'loudnorm_captions_s' : 'loudnorm_clean_s'] = sec(t() - l);
  rmSync(raw);
}

writeFileSync(join(out, 'explainer.vtt'), toWebVtt(tl.captions));

// Poster (FR2-014): the end of scene 0, where the opening question is fully written.
const posterFrame = (tl.scenes[1]?.startFrame ?? 1) - 1;
await renderStill({ serveUrl, composition: await comp(false), frame: posterFrame, output: join(out, 'poster.png'), inputProps: { captions: false } });

// Contact sheet: 8 frames from the delivered (captioned) MP4, one per story beat.
const frames = join(out, 'frames');
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames);
const beats = ['q_crash', 'pipe_bc', 'fill', 'crash', 'await', 'ack_line', 'ack', 'chip_survive'];
beats.forEach((id, i) => {
  const c = tl.cues[id];
  if (!c) throw new Error(`missing cue ${id}`);
  const at = ((c.frame + 14) / 30).toFixed(3);
  run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', at, '-i', join(out, 'explainer.mp4'), '-frames:v', '1', join(frames, `${i + 1}-${id}.png`)]);
});
run('ffmpeg', ['-y', '-loglevel', 'error', '-pattern_type', 'glob', '-i', join(frames, '*.png'), '-vf', 'scale=640:-1,tile=4x2:padding=8:color=0x05070f', '-frames:v', '1', join(out, 'contact-sheet.png')]);

const report = {
  frames: tl.totalFrames,
  duration_s: tl.totalFrames / 30,
  concurrency,
  machine: `${cpus()[0]?.model ?? 'unknown'}, ${cpus().length} cores, ${Math.round(totalmem() / 2 ** 30)} GB`,
  timings,
  poster_frame: posterFrame,
};
writeFileSync(join(out, 'render-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
