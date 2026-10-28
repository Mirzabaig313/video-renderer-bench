// One runnable self-check for the timing model and the message schedule.
import assert from 'node:assert/strict';
import narration from '../src/generated/narration.json';
import { storyboard, wordsOf } from '../src/storyboard';
import { buildTimeline } from '../src/timeline';
import { buildSim, PROC, T_BC } from '../src/sim';

const tl = buildTimeline(storyboard.scenes, narration.scenes);
const sim = buildSim(tl);

// Scenes tile the video with no gaps or drift.
tl.scenes.forEach((s, i) => {
  const next = tl.scenes[i + 1];
  assert.equal(s.startFrame + s.frames, next ? next.startFrame : tl.totalFrames);
  assert.ok(s.frames >= 30, `${s.id} shorter than 1 s`);
});

// Every cue lands inside its own scene (lead frames allowed).
for (const c of Object.values(tl.cues)) {
  const s = tl.scenes.find((x) => x.id === c.scene)!;
  assert.ok(c.frame >= s.startFrame - 4 && c.frame < s.startFrame + s.frames, `cue ${c.id} outside ${s.id}`);
}

// Captions cover 100% of spoken words (NFR2-Q1), 42 chars/line, 2 lines max.
const spoken = storyboard.scenes.flatMap((s) => wordsOf(s.spoken_text)).join(' ');
assert.equal(tl.captions.flatMap((c) => c.lines).join(' '), spoken);
for (const c of tl.captions) {
  assert.ok(c.lines.length <= 2 && c.lines.every((l) => l.length <= 42), JSON.stringify(c.lines));
  assert.ok(c.endMs > c.startMs);
}

// The victim reaches the consumer before the crash and is mid-work when it happens.
const first = sim.victim.deliveries[0]!;
assert.ok(first + T_BC < sim.crash, 'victim must arrive before the crash');
assert.ok(first + T_BC + PROC > sim.crash, 'victim must still be in progress at the crash');
assert.equal(sim.victim.deliveries.length, 2);

// Static-frame rule (FR2-009): no gap between visual events over 15 s.
const events = Object.values(tl.cues).map((c) => c.frame).sort((a, b) => a - b);
events.push(tl.totalFrames);
events.reduce((prev, e) => (assert.ok(e - prev <= 15 * 30, `static gap ${prev}->${e}`), e), 0);

console.log(`ok: ${tl.totalFrames} frames (${(tl.totalFrames / 30).toFixed(2)} s), ${Object.keys(tl.cues).length} cues, ${tl.captions.length} captions, ${sim.msgs.length} messages`);
console.log(Object.values(tl.cues).map((c) => `${c.id}@${c.frame}`).join(' '));
