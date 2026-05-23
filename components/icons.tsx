/** Minimal inline icon set — thin 1.5px strokes, editorial. No icon dep. */
import type { SVGProps } from "react";

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
};

export const IconMic = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} width="18" height="18" {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7" />
  </svg>
);

export const IconPlay = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} width="18" height="18" {...p}>
    <path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none" />
  </svg>
);

export const IconPause = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} width="18" height="18" {...p}>
    <rect x="6.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" />
    <rect x="14" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" />
  </svg>
);

export const IconReplay = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} width="18" height="18" {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4" />
  </svg>
);

export const IconVolume = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} width="18" height="18" {...p}>
    <path d="M4 9v6h4l5 4V5L8 9zM16 9a3.5 3.5 0 0 1 0 6M18.5 6.5a7 7 0 0 1 0 11" />
  </svg>
);

export const IconMute = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} width="18" height="18" {...p}>
    <path d="M4 9v6h4l5 4V5L8 9zM22 9l-6 6M16 9l6 6" />
  </svg>
);

export const IconArrowReturn = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} width="14" height="14" {...p}>
    <path d="M9 10 4 15l5 5M4 15h11a5 5 0 0 0 5-5V4" />
  </svg>
);

export const IconSparkle = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} width="16" height="16" {...p}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 4l.7 2 .3.7M5 18l.7 1.4" />
  </svg>
);

export const IconClose = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} width="16" height="16" {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} width="14" height="14" {...p}>
    <path d="M4 12l5 5L20 6" />
  </svg>
);

export const IconWarn = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} width="14" height="14" {...p}>
    <path d="M12 4 2 20h20zM12 10v5M12 18h.01" />
  </svg>
);
