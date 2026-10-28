import type { Hold, Pace } from './theme';

// A cut-down version of the storyboard contract (VIDEO-PIPELINE.md §7). The model would author
// this object; everything after it is deterministic. Cues name a word in the scene's spoken
// text and a motion recipe (§20 "named motion recipes") that expands into concrete animation.
export type Recipe =
  | 'writeTitle'
  | 'indicate'
  | 'dockTitle'
  | 'buildPipeline'
  | 'streamMessages'
  | 'crash'
  | 'zoomAndOpen'
  | 'codeHighlight'
  | 'redeliver'
  | 'recap';

export type Cue = {
  id: string; // unique across the storyboard
  word: number; // word index in spoken_text (split on whitespace)
  do: Recipe;
  pace: Pace;
};

export type Scene = {
  id: string;
  spoken_text: string; // written form: captions show this
  cues: Cue[];
  hold_after: Hold;
};

// Pronunciation lexicon (§9.2): whole-word replacements applied to the audio only.
export const lexicon: { match: string; say: string }[] = [{ match: 'channel.ack', say: 'channel dot ack' }];

export const storyboard: { title: string; scenes: Scene[] } = {
  title: 'Message queues · Part 2',
  scenes: [
    {
      id: 'hook',
      spoken_text: 'What happens to a message if the consumer crashes?',
      cues: [
        { id: 'q_write', word: 0, do: 'writeTitle', pace: 'slow' },
        { id: 'q_crash', word: 8, do: 'indicate', pace: 'normal' },
      ],
      hold_after: 'short',
    },
    {
      id: 'pipeline',
      spoken_text: 'A producer sends messages to a broker, and a consumer takes them off the queue.',
      cues: [
        { id: 'q_dock', word: 0, do: 'dockTitle', pace: 'normal' },
        { id: 'producer', word: 1, do: 'buildPipeline', pace: 'normal' },
        { id: 'pipe_pb', word: 3, do: 'buildPipeline', pace: 'normal' },
        { id: 'broker', word: 6, do: 'buildPipeline', pace: 'normal' },
        { id: 'consumer', word: 9, do: 'buildPipeline', pace: 'normal' },
        { id: 'pipe_bc', word: 11, do: 'buildPipeline', pace: 'normal' },
      ],
      hold_after: 'none',
    },
    {
      id: 'stream',
      spoken_text: 'Orders stream in. The queue fills, then drains.',
      cues: [
        { id: 'stream', word: 0, do: 'streamMessages', pace: 'quick' },
        { id: 'fill', word: 4, do: 'streamMessages', pace: 'normal' },
        { id: 'drain', word: 6, do: 'streamMessages', pace: 'normal' },
      ],
      hold_after: 'none',
    },
    {
      id: 'crash',
      spoken_text: 'Then the consumer crashes.',
      cues: [{ id: 'crash', word: 3, do: 'crash', pace: 'normal' }],
      hold_after: 'short',
    },
    {
      id: 'inside',
      spoken_text: 'Inside the broker, the message is not deleted. It waits, unacknowledged.',
      cues: [
        { id: 'zoom', word: 0, do: 'zoomAndOpen', pace: 'slow' },
        { id: 'counters', word: 3, do: 'zoomAndOpen', pace: 'normal' },
        { id: 'await', word: 9, do: 'zoomAndOpen', pace: 'normal' },
      ],
      hold_after: 'short',
    },
    {
      id: 'code',
      spoken_text: 'Consumers acknowledge only after the work is done, with channel.ack.',
      cues: [
        { id: 'split', word: 0, do: 'codeHighlight', pace: 'slow' },
        { id: 'work_line', word: 5, do: 'codeHighlight', pace: 'quick' },
        { id: 'ack_line', word: 9, do: 'codeHighlight', pace: 'quick' },
      ],
      hold_after: 'none',
    },
    {
      id: 'recover',
      spoken_text: 'When the consumer recovers, the broker redelivers the message, and this time it is acknowledged.',
      cues: [
        { id: 'pullback', word: 0, do: 'redeliver', pace: 'slow' },
        { id: 'recover', word: 3, do: 'redeliver', pace: 'normal' },
        { id: 'redeliver', word: 6, do: 'redeliver', pace: 'normal' },
        { id: 'ack', word: 14, do: 'redeliver', pace: 'quick' },
      ],
      hold_after: 'none',
    },
    {
      id: 'recap',
      spoken_text: 'Nothing is lost. Ack after the work, and every message survives a crash.',
      cues: [
        { id: 'title_lost', word: 0, do: 'recap', pace: 'normal' },
        { id: 'chip_ack', word: 3, do: 'recap', pace: 'normal' },
        { id: 'chip_survive', word: 10, do: 'recap', pace: 'normal' },
      ],
      hold_after: 'long',
    },
  ],
};

export const wordsOf = (text: string): string[] => text.split(/\s+/).filter(Boolean);

export const toSpeech = (text: string): string =>
  lexicon.reduce((t, { match, say }) => t.split(match).join(say), text);
