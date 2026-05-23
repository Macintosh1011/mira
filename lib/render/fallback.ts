import type { RenderModule } from "@/lib/types";

/**
 * Hand-written p5 sketch that ALWAYS renders, in the Ciechanowski palette.
 * Used when generated code throws, the stream errors, or while we wait.
 * A field of soft particles drifting along a flowing sine field — calm,
 * editorial, never blank during a live demo.
 *
 * Same contract as a generated SceneBundle.code body: returns a SceneController.
 * It's ambient (no phases), so setPhase is a no-op.
 */
export const fallbackModule: RenderModule = (container, libs) => {
  const palette = ["#e8c97a", "#8fb98a", "#7fa8c9", "#cd8f6f"];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sketch = (p: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let particles: any[] = [];
    let w = 0;
    let h = 0;

    const seed = () => {
      particles = Array.from({ length: 140 }, () => ({
        x: p.random(w),
        y: p.random(h),
        c: palette[Math.floor(p.random(palette.length))],
        s: p.random(1.2, 3.2),
      }));
    };

    p.setup = () => {
      w = container.clientWidth || 800;
      h = container.clientHeight || 480;
      const c = p.createCanvas(w, h);
      c.style("display", "block");
      p.noStroke();
      seed();
    };

    p.windowResized = () => {
      w = container.clientWidth || w;
      h = container.clientHeight || h;
      p.resizeCanvas(w, h);
      seed();
    };

    p.draw = () => {
      p.background(8, 3, 4, 26); // tinted-black trail fade
      const t = p.frameCount * 0.004;
      for (const pt of particles) {
        const angle =
          p.noise(pt.x * 0.0018, pt.y * 0.0018, t) * Math.PI * 3;
        pt.x += Math.cos(angle) * 0.9;
        pt.y += Math.sin(angle) * 0.9;
        if (pt.x < -10) pt.x = w + 10;
        if (pt.x > w + 10) pt.x = -10;
        if (pt.y < -10) pt.y = h + 10;
        if (pt.y > h + 10) pt.y = -10;
        p.fill(pt.c + "cc");
        p.circle(pt.x, pt.y, pt.s);
      }
    };
  };

  const inst = new libs.p5(sketch, container);
  return { setPhase: () => {}, dispose: () => inst.remove() };
};
