import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { ACTS, sec } from "./timeline";
import { C, rgb } from "./theme";
import { Grain } from "./components/Grain";
import { Vignette } from "./components/Vignette";
import { Narration } from "./audio/Narration";
import { Act1Problem } from "./acts/Act1Problem";
import { Act2Prompt } from "./acts/Act2Prompt";
import { NeuralScene } from "./acts/NeuralScene";
import { Act5Agents } from "./acts/Act5Agents";
import { Act6Vision } from "./acts/Act6Vision";

/** Cross-fade envelope around an act, driven by its local frame. */
const Fade: React.FC<{
  dur: number;
  inF?: number;
  outF?: number;
  children: React.ReactNode;
}> = ({ dur, inF = 10, outF = 10, children }) => {
  const f = useCurrentFrame();
  const opacity = interpolate(f, [0, inF, dur - outF, dur], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

const Layer: React.FC<{
  win: { start: number; end: number };
  inF?: number;
  outF?: number;
  children: React.ReactNode;
}> = ({ win, inF, outF, children }) => {
  const dur = sec(win.end - win.start);
  return (
    <Sequence from={sec(win.start)} durationInFrames={dur}>
      <Fade dur={dur} inF={inF} outF={outF}>
        {children}
      </Fade>
    </Sequence>
  );
};

const neuralWin = { start: ACTS.magic.start, end: ACTS.killer.end };

export const Mira60: React.FC = () => (
  <AbsoluteFill style={{ background: rgb(C.bgDeep) }}>
    <Layer win={ACTS.problem} inF={18} outF={20}>
      <Act1Problem />
    </Layer>
    <Layer win={ACTS.prompt} inF={16} outF={14}>
      <Act2Prompt />
    </Layer>
    <Layer win={neuralWin} inF={16} outF={18}>
      <NeuralScene />
    </Layer>
    <Layer win={ACTS.agents} inF={16} outF={16}>
      <Act5Agents />
    </Layer>
    <Layer win={ACTS.vision} inF={14} outF={10}>
      <Act6Vision />
    </Layer>

    {/* global post */}
    <Vignette />
    <Grain />
    <Narration />
  </AbsoluteFill>
);
