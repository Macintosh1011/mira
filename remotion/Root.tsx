import React from "react";
import { Composition } from "remotion";
import { Mira60 } from "./Mira60";
import { WIDTH, HEIGHT, FPS } from "./theme";
import { DURATION } from "./timeline";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Mira60"
    component={Mira60}
    durationInFrames={DURATION}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
  />
);
