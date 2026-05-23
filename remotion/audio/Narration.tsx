import React from "react";
import { Audio, Sequence, staticFile, interpolate } from "remotion";
import { CUES } from "../timeline";

/**
 * All ElevenLabs narration, absolutely placed on the master timeline. Each cue
 * gets a short fade in/out so back-to-back clips never click. User-prompt lines
 * sit a touch hotter so the "person asking" cuts through.
 */
export const Narration: React.FC = () => (
  <>
    {CUES.map((c) => {
      const peak = c.role === "user" ? 1 : 0.92;
      const fade = Math.min(4, Math.floor(c.durationInFrames * 0.12));
      return (
        <Sequence key={c.id} from={c.startFrame} durationInFrames={c.durationInFrames}>
          <Audio
            src={staticFile(c.file)}
            volume={(f) =>
              interpolate(
                f,
                [0, fade, c.durationInFrames - fade, c.durationInFrames],
                [0, peak, peak, 0],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
              )
            }
          />
        </Sequence>
      );
    })}
  </>
);
