import React from 'react';
import { Composition } from 'remotion';
import { Explainer, timeline } from './Explainer';
import { FPS, HEIGHT, WIDTH } from './theme';

export const Root: React.FC = () => (
  <>
    <Composition
      id="Explainer"
      component={Explainer}
      durationInFrames={timeline.totalFrames}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ captions: false }}
    />
  </>
);
