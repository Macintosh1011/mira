import React from "react";
import { Composition } from "remotion";
import { Mira60 } from "./Mira60";
import { Thumbnail } from "./Thumbnail";
import { WIDTH, HEIGHT, FPS } from "./theme";
import { DURATION } from "./timeline";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Mira60"
      component={Mira60}
      durationInFrames={DURATION}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
    <Composition
      id="ThumbRecognition"
      component={Thumbnail}
      defaultProps={{ variant: "recognition" as const }}
      durationInFrames={1}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
    <Composition
      id="ThumbPrompt"
      component={Thumbnail}
      defaultProps={{ variant: "prompt" as const }}
      durationInFrames={1}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
    <Composition
      id="ThumbMorph"
      component={Thumbnail}
      defaultProps={{ variant: "morph" as const }}
      durationInFrames={1}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  </>
);
