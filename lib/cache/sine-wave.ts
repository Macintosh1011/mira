import type { SceneBundle } from "@/lib/types";

/**
 * Hand-authored fallback: how a sine wave is the shadow of circular motion.
 * 2D p5. Real render-module body per the contract. A rotating phasor on the
 * left projects its height across to trace a sine curve on the right.
 */
const code = `
const W = container.clientWidth || 960, H = container.clientHeight || 600;
const sketch = (p) => {
  const BG = [14, 12, 13];
  const TEXT = [232, 226, 216];
  const TERRA = [217, 138, 106];
  const YELLOW = [232, 196, 104];
  const BLUE = [122, 162, 194];
  let t = 0;
  const R = Math.min(W, H) * 0.18;
  const cx = W * 0.24, cy = H * 0.5;
  const axisX = W * 0.42;
  const trail = [];
  p.setup = () => { p.createCanvas(W, H); p.textFont("Georgia"); };
  p.draw = () => {
    p.background(BG[0], BG[1], BG[2]);
    t += 0.02;
    const angle = t;
    const py = cy - Math.sin(angle) * R;
    const handX = cx + Math.cos(angle) * R;
    // circle
    p.noFill();
    p.stroke(TEXT[0], TEXT[1], TEXT[2], 70);
    p.strokeWeight(1.5);
    p.circle(cx, cy, R * 2);
    // radius / phasor
    p.stroke(YELLOW[0], YELLOW[1], YELLOW[2], 220);
    p.line(cx, cy, handX, py);
    p.noStroke();
    p.fill(YELLOW[0], YELLOW[1], YELLOW[2]);
    p.circle(handX, py, 9);
    // projection line to the axis
    p.stroke(TERRA[0], TERRA[1], TERRA[2], 120);
    p.strokeWeight(1.5);
    p.line(handX, py, axisX, py);
    // wave trail: scroll left-to-right
    trail.unshift(py);
    if (trail.length > Math.floor(W * 0.5)) trail.pop();
    p.noFill();
    p.stroke(BLUE[0], BLUE[1], BLUE[2], 230);
    p.strokeWeight(1.5);
    p.beginShape();
    for (let i = 0; i < trail.length; i++) {
      p.vertex(axisX + i, trail[i]);
    }
    p.endShape();
    // midline
    p.stroke(TEXT[0], TEXT[1], TEXT[2], 40);
    p.strokeWeight(1);
    p.line(axisX, cy, W - 20, cy);
    // moving dot at wave head
    p.noStroke();
    p.fill(TERRA[0], TERRA[1], TERRA[2]);
    p.circle(axisX, py, 9);
    p.fill(TEXT[0], TEXT[1], TEXT[2], 180);
    p.textAlign(p.LEFT, p.TOP);
    p.textSize(13);
    p.text("A sine wave is the shadow of circular motion", 28, 24);
  };
};
const inst = new libs.p5(sketch, container);
return () => inst.remove();
`.trim();

export const sineWave: SceneBundle = {
  sceneId: "cache-sine-wave",
  renderer: "2d",
  code,
  narration: [
    {
      phaseId: "circle",
      text: "Picture a point moving steadily around a circle at a constant speed.",
      startMs: 0,
    },
    {
      phaseId: "project",
      text: "Now watch only its height. We project that vertical position straight across to the right.",
      startMs: 3000,
    },
    {
      phaseId: "wave",
      text: "As time scrolls forward, that height traces out a perfect sine wave. The wave is just the shadow of the spin.",
      startMs: 6000,
    },
  ],
};
