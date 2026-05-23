/**
 * Hand-authored topic registry. When a user's query matches a registered topic,
 * the shell plays a pixel-perfect SVG animation (instant, demo-insurance) driven
 * by the caption/phase timing model below — instead of hitting live generation.
 *
 * Adding a topic = one entry here + one SVG canvas component keyed by `canvas`.
 * The shell needs no other changes.
 */

export type TopicCanvas = "NNCanvas" | "FedCanvas";

export interface TopicCaption {
  /** ms since playback start. */
  t: number;
  text: string;
}

export interface TopicPhase {
  /** ms since playback start. */
  t: number;
}

export interface Topic {
  id: string;
  /** Shown in the state badge. */
  label: string;
  /** The canonical question text. */
  query: string;
  /** Partial transcripts streamed during listening. */
  transcription: string[];
  captions: TopicCaption[];
  phases: TopicPhase[];
  /** Total ms. */
  duration: number;
  canvas: TopicCanvas;
  /** Phase-indicator labels, left → right. */
  phaseLabels: string[];
  /** Keywords that route a free-text query to this topic. */
  keywords: string[];
}

export const TOPICS: Record<string, Topic> = {
  "neural-network": {
    id: "neural-network",
    label: "Neural network",
    query: "Explain how a neural network classifies a handwritten digit",
    transcription: [
      "Explain how",
      "Explain how a neural",
      "Explain how a neural network",
      "Explain how a neural network classifies",
      "Explain how a neural network classifies a",
      "Explain how a neural network classifies a handwritten digit",
    ],
    captions: [
      {
        t: 0,
        text: "A neural network sees an image as raw pixels — here, a hand-drawn seven on an eight-by-eight grid.",
      },
      {
        t: 4400,
        text: "The first hidden layer fires when it detects simple features — the diagonal stroke, the upper edge.",
      },
      {
        t: 9200,
        text: "The next layer composes those edges into higher-order shapes — the overall silhouette of the digit.",
      },
      {
        t: 14000,
        text: "The output layer produces a probability for each possible digit zero through nine.",
      },
      {
        t: 18800,
        text: "Class seven wins decisively. The network commits to its prediction with high confidence.",
      },
    ],
    phases: [{ t: 0 }, { t: 5400 }, { t: 10200 }, { t: 15000 }],
    phaseLabels: ["input pixels", "hidden layer 1", "hidden layer 2", "classify"],
    duration: 24000,
    canvas: "NNCanvas",
    keywords: [
      "neural",
      "network",
      "classif",
      "digit",
      "handwritten",
      "mnist",
      "transformer",
      "attention",
      "backprop",
      "neuron",
      "deep learning",
    ],
  },

  "fed-rate": {
    id: "fed-rate",
    label: "Fed rate cut",
    query: "Animate how a Fed rate cut ripples through the mortgage market",
    transcription: [
      "Animate",
      "Animate how a Fed",
      "Animate how a Fed rate cut",
      "Animate how a Fed rate cut ripples",
      "Animate how a Fed rate cut ripples through the",
      "Animate how a Fed rate cut ripples through the mortgage market",
    ],
    captions: [
      {
        t: 0,
        text: "When the Federal Reserve cuts its policy rate, the move radiates outward through every credit market.",
      },
      {
        t: 4200,
        text: "First, longer-dated Treasury yields adjust as investors reprice the path of future short rates.",
      },
      {
        t: 8600,
        text: "Mortgage-backed-security spreads compress in parallel, narrowing the premium lenders demand over Treasuries.",
      },
      {
        t: 12800,
        text: "These two forces flow into the 30-year mortgage rate — the price homebuyers actually see.",
      },
      {
        t: 17400,
        text: "Lower mortgage rates pull refinancing applications out of dormancy and revive purchase demand.",
      },
      {
        t: 21800,
        text: "And as financing eases, home prices firm — closing the loop from policy back to households.",
      },
    ],
    phases: [{ t: 0 }, { t: 5200 }, { t: 11400 }, { t: 17200 }],
    phaseLabels: ["policy rate", "bond market", "mortgage rate", "demand"],
    duration: 26000,
    canvas: "FedCanvas",
    keywords: [
      "fed",
      "rate",
      "cut",
      "mortgage",
      "interest",
      "reserve",
      "treasury",
      "bond",
      "housing",
      "monetary",
      "refinanc",
      "ripple",
    ],
  },
};

export const RECENTS: string[] = [
  "Visualize how a transformer attention head routes tokens",
  "Animate how a Fed rate cut ripples through the mortgage market",
  "Explain backpropagation through a tiny example",
];

/**
 * Route a free-text query to a registered hand-authored topic, or null to fall
 * through to live generation. Keyword scorer (longer keywords weighted more),
 * with a minimum threshold so novel queries don't snap to a topic by accident.
 */
export function matchTopic(query: string): Topic | null {
  const q = query.toLowerCase();
  let best: Topic | null = null;
  let bestScore = 0;
  for (const topic of Object.values(TOPICS)) {
    let s = 0;
    for (const kw of topic.keywords) {
      if (q.includes(kw)) s += kw.length >= 5 ? 2 : 1;
    }
    if (s > bestScore) {
      bestScore = s;
      best = topic;
    }
  }
  return bestScore >= 2 ? best : null;
}
