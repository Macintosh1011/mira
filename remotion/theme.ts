/**
 * Mira video — design tokens. Ported from the app's globals.css / kit palette so
 * the film matches the product exactly (separate Webpack bundle = its own copy).
 */
import { loadFont as loadFraunces } from "@remotion/google-fonts/Fraunces";
import { loadFont as loadGeist } from "@remotion/google-fonts/Geist";
import { loadFont as loadGeistMono } from "@remotion/google-fonts/GeistMono";

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

const fraunces = loadFraunces();
const geist = loadGeist();
const geistMono = loadGeistMono();

export const FONT = {
  display: fraunces.fontFamily, // Fraunces — serif headlines / wordmark
  sans: geist.fontFamily, // Geist — body / captions
  mono: geistMono.fontFamily, // Geist Mono — labels / data / UI chrome
};

export type RGB = readonly [number, number, number];

export const C = {
  bg: [12, 12, 14] as RGB, // #0c0c0e near-black, warm-tinted
  bgDeep: [7, 7, 9] as RGB, // darker plate for cuts
  surface: [20, 20, 24] as RGB,
  fg: [244, 244, 245] as RGB, // #f4f4f5 — never pure white
  fgMuted: [161, 161, 170] as RGB,
  fgSubtle: [82, 82, 91] as RGB,
  accent: [239, 197, 64] as RGB, // #efc540 amber — the "7" / active / winner
  terracotta: [239, 127, 57] as RGB,
  teal: [49, 192, 177] as RGB, // edges / secondary signal
  blue: [70, 140, 220] as RGB, // the rival "1" — cool against amber
  rival: [96, 165, 250] as RGB, // brighter cool blue for the competing digit
  pink: [218, 123, 163] as RGB,
  deepRed: [164, 18, 71] as RGB,
};

export const rgb = (c: RGB, a = 1) =>
  a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** Linear blend between two RGB colors, t in 0..1. */
export const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
