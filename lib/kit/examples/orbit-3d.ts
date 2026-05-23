/**
 * EXAMPLE — minimal flat-shaded 3D scene, built on the kit's scene3d helper.
 *
 * Not a reference-topic rebuild (the reference vocabularies are 2D); this is
 * the canonical SHAPE a generated 3d scene should take so the codegen model
 * has a correct, leak-free three.js exemplar to copy. Returns cleanup that
 * cancels rAF, disposes geometry/material, and tears down the renderer.
 */
export const ORBIT_3D_BODY = String.raw`const kit = libs.kit;
const THREE = libs.THREE;
const { palette } = kit;

const s3 = kit.scene3d(THREE, container, { distance: 6 });
const core = kit.flatSphere(THREE, 1.4, palette.accent, false);
s3.scene.add(core);
const shell = kit.flatSphere(THREE, 2.2, palette.blue, true);
s3.scene.add(shell);
const ring = kit.flatLine(THREE,
  Array.from({ length: 65 }, (_, i) => {
    const a = (i / 64) * Math.PI * 2;
    return [Math.cos(a) * 2.8, Math.sin(a) * 2.8 * 0.35, Math.sin(a) * 2.8];
  }),
  palette.teal);
s3.scene.add(ring);

let raf = 0;
const loop = () => {
  shell.rotation.y += 0.003; shell.rotation.x += 0.0015;
  core.rotation.y -= 0.004;
  ring.rotation.z += 0.002;
  s3.render();
  raf = requestAnimationFrame(loop);
};
loop();
const onResize = () => s3.resize();
window.addEventListener("resize", onResize);

return () => {
  cancelAnimationFrame(raf);
  window.removeEventListener("resize", onResize);
  core.geometry.dispose(); core.material.dispose();
  shell.geometry.dispose(); shell.material.dispose();
  ring.geometry.dispose(); ring.material.dispose();
  s3.dispose();
};`;
