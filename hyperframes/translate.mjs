// Deterministic translator: closed-vocabulary storyboard -> HyperFrames composition.
// Reads storyboard.json (what the model would author) and narration.json (measured audio + word
// marks, copied from the Remotion prototype), validates them against a closed vocabulary, ports
// the Remotion timing model (src/timeline.ts) and message schedule (src/sim.ts), and writes:
//   project/plan.js     window.__PLAN = { timeline, cues, words, captions, sim }  (data only)
//   project/index.html  the HyperFrames composition root: size, fps, duration, one <audio> per
//                       scene at its planned time, and the two scripts (plan.js, scene.js)
// The model never writes HTML or JS: it can only pick recipes, cue words and paces listed here.
// All drawing lives in project/scene.js (our recipe library). Same input -> byte-identical output.
//
// Usage: node translate.mjs [--check]
//   --check  also asserts the port matches the Remotion baseline (frames, captions) and the
//            ManimGX spike's plan (every cue frame and the whole message schedule).
import { readFileSync, writeFileSync } from 'node:fs';
import { deepStrictEqual, ok } from 'node:assert/strict';

const here = (p) => new URL(p, import.meta.url);
const RECIPES = new Set(['writeTitle', 'indicate', 'dockTitle', 'buildPipeline', 'streamMessages', 'crash', 'zoomAndOpen', 'codeHighlight', 'redeliver', 'recap']);
const T_PB = 24, T_BC = 20, PROC = 9, T_ACK = 12, SERVICE = 12; // frames, src/sim.ts

const wordsOf = (text) => text.split(/\s+/).filter(Boolean);

function validate(sb, nar) {
  const seen = new Set();
  ok(sb.scenes.length === nar.scenes.length, 'narration scene count differs');
  sb.scenes.forEach((scene, s) => {
    const audio = nar.scenes[s];
    ok(audio.id === scene.id, `narration missing for ${scene.id}`);
    const n = wordsOf(scene.spoken_text).length;
    ok(audio.marks.length === n, `narration for ${scene.id} is stale`);
    ok(scene.hold_after in sb.hold_ms, `unknown hold ${scene.hold_after}`);
    ok(/^[a-z]+$/.test(audio.audio.replace(/^audio\/|\.wav$/g, '')), `bad audio name ${audio.audio}`);
    for (const cue of scene.cues) {
      ok(RECIPES.has(cue.do), `cue ${cue.id}: unknown recipe ${cue.do}`);
      ok(cue.pace in sb.pace_ms, `cue ${cue.id}: unknown pace ${cue.pace}`);
      ok(Number.isInteger(cue.word) && cue.word >= 0 && cue.word < n, `cue ${cue.id} targets a word outside ${scene.id}`);
      ok(/^[a-z_]+$/.test(cue.id), `bad cue id ${cue.id}`);
      ok(!seen.has(cue.id), `duplicate cue id ${cue.id}`);
      seen.add(cue.id);
    }
  });
}

function buildTimeline(sb, nar) {
  const { fps, timing: tm } = sb;
  const msToFrame = (ms) => Math.round((ms * fps) / 1000);
  let cursor = tm.opening_ms;
  const scenes = [], cues = {}, words = [];
  sb.scenes.forEach((scene, s) => {
    const audio = nar.scenes[s];
    const start = cursor;
    const base = start + tm.pad_in_ms;
    scenes.push({ id: scene.id, audio: audio.audio, start_frame: msToFrame(start), audio_from: msToFrame(base), audio_ms: audio.audio_ms });
    for (const m of audio.marks) words.push({ scene: scene.id, text: m.text, start_ms: base + m.start_ms, end_ms: base + m.end_ms });
    for (const cue of scene.cues) {
      const wordMs = base + audio.marks[cue.word].start_ms;
      cues[cue.id] = {
        id: cue.id, scene: scene.id, do: cue.do,
        frame: Math.max(0, Math.floor((wordMs * fps) / 1000) - tm.lead_frames),
        frames: Math.round((sb.pace_ms[cue.pace] * fps) / 1000),
      };
    }
    cursor += tm.pad_in_ms + audio.audio_ms + tm.pad_out_ms + sb.hold_ms[scene.hold_after];
  });
  return { fps, total_frames: msToFrame(cursor), scenes, cues, words, captions: buildCaptions(words) };
}

function wrap(ws, max = 42) {
  const lines = [];
  for (const w of ws) {
    if (lines.length && (lines.at(-1) + ' ' + w).length <= max) lines[lines.length - 1] += ' ' + w;
    else lines.push(w);
  }
  if (lines.length !== 2) return lines;
  const score = (p) => Math.max(...p.map((l) => l.length)) - (p[0].endsWith(',') ? 10 : 0);
  let best = lines;
  for (let i = 1; i < ws.length; i++) {
    const pair = [ws.slice(0, i).join(' '), ws.slice(i).join(' ')];
    if (pair.every((l) => l.length <= max) && score(pair) < score(best)) best = pair;
  }
  return best;
}

// Port of timeline.ts buildCaptions: sentence breaks, 42 characters per line, 2 lines.
function buildCaptions(words) {
  const out = [];
  let group = [];
  const flush = () => {
    if (group.length) out.push({ start_ms: group[0].start_ms, end_ms: group.at(-1).end_ms + 250, lines: wrap(group.map((g) => g.text)) });
    group = [];
  };
  for (const w of words) {
    const prev = group.at(-1);
    const tooLong = wrap([...group, w].map((g) => g.text)).length > 2;
    if (prev && (prev.scene !== w.scene || tooLong || w.end_ms - group[0].start_ms > 7000)) {
      const comma = group.findLastIndex((g, i) => i > 0 && i < group.length - 1 && /,$/.test(g.text));
      const rest = prev.scene === w.scene && comma > 0 ? group.splice(comma + 1) : [];
      flush();
      group = rest;
    }
    group.push(w);
    if (/[.?!]$/.test(w.text)) flush();
  }
  flush();
  out.forEach((c, i) => { if (out[i + 1] && c.end_ms > out[i + 1].start_ms) c.end_ms = out[i + 1].start_ms; });
  return out;
}

// Port of src/sim.ts: deterministic message schedule from cue frames.
function buildSim(tl) {
  const f = Object.fromEntries(Object.values(tl.cues).map((c) => [c.id, c.frame]));
  const { stream, fill, drain, crash, recover, redeliver, ack } = f;
  const end = tl.total_frames;
  const spawns = [];
  for (let s = stream - T_PB + 2; s < recover; s += s < fill - T_PB ? 16 : s < drain - 18 ? 3 : s < crash ? 30 : 64) spawns.push(s);
  const msgs = spawns.map((spawn, i) => ({ i, label: `{"order": ${1040 + i}}`, spawn, arrive: spawn + T_PB, deliveries: [], ack_start: null, ack_arrive: null, victim: false }));
  const lastNormal = crash - T_BC - PROC - 2;
  let free = stream, k = 0;
  for (; k < msgs.length; k++) {
    const m = msgs[k];
    const d = Math.max(m.arrive, free);
    if (d > lastNormal) break;
    m.deliveries.push(d);
    m.ack_start = d + T_BC + PROC;
    m.ack_arrive = m.ack_start + T_ACK;
    free = d + SERVICE;
  }
  ok(k < msgs.length, 'no message left to be the victim');
  const v = msgs[k];
  v.victim = true;
  v.deliveries.push(Math.max(v.arrive, crash - T_BC - 3), redeliver);
  v.ack_arrive = ack + 3;
  v.ack_start = v.ack_arrive - T_ACK;
  free = v.ack_arrive + 4;
  for (const m of msgs.slice(k + 1)) {
    const d = Math.max(m.arrive, free);
    if (d > end) break;
    m.deliveries.push(d);
    m.ack_start = d + T_BC + PROC;
    m.ack_arrive = m.ack_start + T_ACK;
    free = d + SERVICE + 4;
  }
  return { T_PB, T_BC, PROC, T_ACK, victim: k, crash, recover, msgs };
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function emitIndex(plan, title) {
  const fps = plan.fps;
  // HyperFrames renders ceil(duration * fps) frames; stay just under the frame count.
  const duration = ((plan.total_frames - 0.01) / fps).toFixed(4);
  const audio = plan.scenes
    .map((s) => `  <audio id="vo-${s.id}" src="assets/${s.audio}" data-start="${(s.audio_from / fps).toFixed(4)}" data-duration="${(s.audio_ms / 1000).toFixed(3)}" data-volume="1"></audio>`)
    .join('\n');
  return `<!doctype html>
<!-- GENERATED by translate.mjs from storyboard.json + narration.json. Do not edit. -->
<html lang="en" data-composition-variables='[{"id":"captions","type":"boolean","label":"Burn in captions","default":false}]'>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1920, height=1080" />
<title>${esc(title)}</title>
<script src="vendor/gsap.min.js"></script>
<link rel="stylesheet" href="scene.css" />
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="1920" data-height="1080" data-fps="${fps}">
  <svg id="stage" width="1920" height="1080" viewBox="0 0 1920 1080"></svg>
  <div id="captions" aria-live="off"></div>
  <div id="sim" data-composition-id="sim" data-start="0" data-duration="${duration}" data-no-timeline></div>
${audio}
</div>
<script src="plan.js"></script>
<script src="scene.js"></script>
<script>
  // Inline so \`hyperframes lint\` / \`check\` can see the registration (they read the HTML only).
  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = window.__explainer.timeline;
</script>
</body>
</html>
`;
}

const sb = JSON.parse(readFileSync(here('storyboard.json'), 'utf8'));
const nar = JSON.parse(readFileSync(here('narration.json'), 'utf8'));
validate(sb, nar);
const tl = buildTimeline(sb, nar);
const plan = { ...tl, title: sb.title, sim: buildSim(tl) };
writeFileSync(here('project/plan.js'), `// GENERATED by translate.mjs. Do not edit.\nwindow.__PLAN = ${JSON.stringify(plan)};\n`);
writeFileSync(here('project/index.html'), emitIndex(plan, sb.title));
console.log(`${tl.total_frames} frames, ${Object.keys(tl.cues).length} cues, ${plan.sim.msgs.length} messages, ${tl.captions.length} captions`);

if (process.argv.includes('--check')) {
  const report = JSON.parse(readFileSync(here('../remotion/out/render-report.json'), 'utf8'));
  deepStrictEqual(tl.total_frames, report.frames);
  const vtt = readFileSync(here('../remotion/out/explainer.vtt'), 'utf8') + '\n';
  const ref = [...vtt.matchAll(/(\d\d):(\d\d):(\d\d)\.(\d{3}) --> (\d\d):(\d\d):(\d\d)\.(\d{3})\n(.*?)\n\n/gs)];
  const ms = (h, m, s, f) => ((+h * 60 + +m) * 60 + +s) * 1000 + +f;
  deepStrictEqual(ref.length, tl.captions.length);
  tl.captions.forEach((c, i) => {
    const r = ref[i];
    ok(Math.abs(ms(...r.slice(1, 5)) - c.start_ms) <= 1 && Math.abs(ms(...r.slice(5, 9)) - c.end_ms) <= 1, `caption ${i} timing`);
    deepStrictEqual(r[9].split('\n'), c.lines);
  });
  const mgx = JSON.parse(readFileSync(here('../manimgx/generated/plan.json'), 'utf8'));
  for (const [id, c] of Object.entries(mgx.cues)) deepStrictEqual({ frame: tl.cues[id].frame, frames: tl.cues[id].frames }, { frame: c.frame, frames: c.frames }, id);
  deepStrictEqual(plan.sim, mgx.sim);
  deepStrictEqual(tl.scenes.map((s) => [s.id, s.start_frame, s.audio_from]), mgx.scenes.map((s) => [s.id, s.start_frame, s.audio_from]));
  console.log(`check ok: ${tl.total_frames} frames and all ${tl.captions.length} captions match Remotion; all ${Object.keys(mgx.cues).length} cue frames, scene starts and the ${plan.sim.msgs.length}-message schedule match the ManimGX plan`);
}
