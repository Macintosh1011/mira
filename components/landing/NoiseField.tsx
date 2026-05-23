"use client";

import { useEffect, useRef, useState } from "react";
import type * as THREE_NS from "three";

/**
 * NoiseField — the LANDING (empty) state backdrop only.
 *
 * A slow, organic Perlin/simplex-displaced wireframe surface, post-processed
 * with an ordered (Bayer) dither for an editorial, print-grain feel and a
 * radial vignette that keeps the center (wordmark/tagline/⌘K) dark and crisp.
 *
 * three touches `window`, so it's dynamic-imported in the effect, exactly like
 * lib/render/libs.ts — never at module top level. The whole pipeline (renderer,
 * scene, geometry, materials, render targets, rAF, listeners) is torn down on
 * unmount so switching out of the empty state leaks no WebGL context.
 *
 * Honors prefers-reduced-motion (single static frame) and pauses rAF when the
 * tab is hidden.
 */

// ── GLSL ──────────────────────────────────────────────────────────────────
//
// Simplex 3D noise (Ashima / Stefan Gustavson, public domain) drives the
// vertex displacement so the surface undulates slowly and organically.

const SIMPLEX_GLSL = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}

float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(
        i.z+vec4(0.0,i1.z,i2.z,1.0))
      + i.y+vec4(0.0,i1.y,i2.y,1.0))
      + i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
`;

const MESH_VERT = /* glsl */ `
uniform float uTime;
uniform float uAmp;
varying float vElev;

${SIMPLEX_GLSL}

float fbm(vec3 p){
  float a=0.0;
  a+=snoise(p)*0.62;
  a+=snoise(p*2.07+13.1)*0.28;
  a+=snoise(p*4.13+41.7)*0.12;
  return a;
}

void main(){
  vec3 pos=position;
  // Two layered, slow-drifting octaves give an organic, breathing surface.
  float t=uTime*0.045;
  float e=fbm(vec3(pos.x*0.42, pos.y*0.42, t));
  e+=fbm(vec3(pos.x*0.17-9.0, pos.y*0.17+4.0, t*0.6))*0.5;
  vElev=e;
  pos.z+=e*uAmp;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.0);
}
`;

// Monochrome surface. Elevation drives a near-black -> faint-grey ramp; the
// warm accent bleeds in only at the extreme peaks/troughs at very low intensity.
const MESH_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uBase;
uniform vec3 uHi;
uniform vec3 uAccent;
varying float vElev;

void main(){
  float e=clamp(vElev*0.5+0.5,0.0,1.0);
  vec3 col=mix(uBase,uHi,smoothstep(0.05,0.92,e));
  // Accent only kisses the extremes — barely-there warm texture, never a glow.
  float edge=smoothstep(0.72,1.0,abs(vElev));
  col=mix(col,uAccent,edge*0.12);
  gl_FragColor=vec4(col,1.0);
}
`;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv=uv;
  gl_Position=vec4(position.xy,0.0,1.0);
}
`;

// Ordered-dither (4x4 Bayer) + radial vignette compositing pass. The dither is
// the editorial print-grain signature; the vignette darkens the center so the
// overlaid wordmark stays legible and the motion reads toward the edges.
const POST_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uScene;
uniform vec2 uResolution;
varying vec2 vUv;

const mat4 bayer=mat4(
   0.0,  8.0,  2.0, 10.0,
  12.0,  4.0, 14.0,  6.0,
   3.0, 11.0,  1.0,  9.0,
  15.0,  7.0, 13.0,  5.0
);

float bayerValue(vec2 frag){
  int x=int(mod(frag.x,4.0));
  int y=int(mod(frag.y,4.0));
  // Index the constant matrix without dynamic subscripting (GLSL ES1 safe).
  vec4 row=
     x==0?bayer[0]
    :x==1?bayer[1]
    :x==2?bayer[2]
    :bayer[3];
  float v=
     y==0?row.x
    :y==1?row.y
    :y==2?row.z
    :row.w;
  return (v+0.5)/16.0;
}

void main(){
  vec3 col=texture2D(uScene,vUv).rgb;
  float lum=dot(col,vec3(0.299,0.587,0.114));

  // Ordered dither, applied gently so it grains rather than posterizes.
  float threshold=bayerValue(gl_FragCoord.xy);
  float levels=18.0;
  float dithered=floor(lum*levels+(threshold-0.5))/levels;
  vec3 outCol=col*(dithered/max(lum,1e-4));
  outCol=mix(col,outCol,0.55);

  // Radial vignette — keep the center calm and dark for the wordmark.
  vec2 p=vUv-0.5;
  p.x*=uResolution.x/uResolution.y;
  float d=length(p);
  float center=1.0-smoothstep(0.0,0.40,d);     // darken middle for the wordmark
  float edgeFade=1.0-smoothstep(0.62,1.05,d);    // soft fade toward the frame
  outCol*=mix(1.0,0.22,center);
  outCol*=mix(0.30,1.0,edgeFade);

  gl_FragColor=vec4(outCol,1.0);
}
`;

// ── Tunables ────────────────────────────────────────────────────────────────
// The 800ms mount fade lives in CSS (.noise-field transition in globals.css).
const MAX_DPR = 1.5;

export default function NoiseField() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fadedIn, setFadedIn] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let raf = 0;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const THREE = (await import("three")) as typeof THREE_NS;
      if (disposed || !container) return;

      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const isMobile = window.matchMedia("(max-width: 640px)").matches;

      const renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: true,
        powerPreference: "low-power",
      });
      const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.2 : MAX_DPR);
      renderer.setPixelRatio(dpr);
      renderer.setClearColor(0x0c0c0e, 1);
      const canvas = renderer.domElement;
      canvas.style.position = "absolute";
      canvas.style.inset = "0";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = "block";
      container.appendChild(canvas);

      // ── Scene: an angled, displaced plane viewed from above ────────────────
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
      camera.position.set(0, -3.0, 7.4);
      camera.lookAt(0, 0.6, 0);

      const segs = isMobile ? 110 : 200;
      const geometry = new THREE.PlaneGeometry(20, 12, segs, Math.round(segs * 0.6));

      const meshUniforms = {
        uTime: { value: 0 },
        uAmp: { value: 1.55 },
        uBase: { value: new THREE.Color(0x18181c) },
        uHi: { value: new THREE.Color(0x55555e) },
        uAccent: { value: new THREE.Color(0xefc540) },
      };
      const meshMaterial = new THREE.ShaderMaterial({
        uniforms: meshUniforms,
        vertexShader: MESH_VERT,
        fragmentShader: MESH_FRAG,
        wireframe: true,
        transparent: true,
      });
      const mesh = new THREE.Mesh(geometry, meshMaterial);
      mesh.rotation.x = -Math.PI * 0.46;
      scene.add(mesh);

      // ── Post pass: render scene to a target, then dither+vignette to screen ─
      const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });

      const postScene = new THREE.Scene();
      const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const postUniforms = {
        uScene: { value: renderTarget.texture },
        uResolution: { value: new THREE.Vector2(1, 1) },
      };
      const postMaterial = new THREE.ShaderMaterial({
        uniforms: postUniforms,
        vertexShader: QUAD_VERT,
        fragmentShader: POST_FRAG,
        transparent: true,
      });
      const postQuad = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        postMaterial,
      );
      postScene.add(postQuad);

      const resize = () => {
        const w = container.clientWidth || window.innerWidth;
        const h = container.clientHeight || window.innerHeight;
        renderer.setSize(w, h, false);
        renderTarget.setSize(
          Math.max(1, Math.round(w * dpr)),
          Math.max(1, Math.round(h * dpr)),
        );
        postUniforms.uResolution.value.set(w * dpr, h * dpr);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();

      const renderFrame = () => {
        renderer.setRenderTarget(renderTarget);
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        renderer.render(postScene, postCamera);
      };

      const ro = new ResizeObserver(resize);
      ro.observe(container);

      // Trigger the CSS fade-in once the first frame is on screen.
      requestAnimationFrame(() => {
        if (!disposed) setFadedIn(true);
      });

      if (reducedMotion) {
        // Single static frame — no animation loop.
        meshUniforms.uTime.value = 12.0;
        renderFrame();
        cleanup = () => {
          ro.disconnect();
          geometry.dispose();
          meshMaterial.dispose();
          postQuad.geometry.dispose();
          postMaterial.dispose();
          renderTarget.dispose();
          renderer.dispose();
          renderer.forceContextLoss();
          if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        };
        return;
      }

      const start = performance.now();
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        meshUniforms.uTime.value = (now - start) / 1000;
        renderFrame();
      };
      raf = requestAnimationFrame(loop);

      const onVisibility = () => {
        if (document.hidden) {
          if (raf) cancelAnimationFrame(raf);
          raf = 0;
        } else if (!raf && !disposed) {
          raf = requestAnimationFrame(loop);
        }
      };
      document.addEventListener("visibilitychange", onVisibility);

      cleanup = () => {
        document.removeEventListener("visibilitychange", onVisibility);
        ro.disconnect();
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        geometry.dispose();
        meshMaterial.dispose();
        postQuad.geometry.dispose();
        postMaterial.dispose();
        renderTarget.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      };
    })();

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      cleanup?.();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="noise-field"
      data-faded={fadedIn ? "in" : "out"}
      aria-hidden="true"
    />
  );
}
