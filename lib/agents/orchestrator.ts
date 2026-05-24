/**
 * Orchestrator agent: query -> ScenePlan, or query -> SimPlan.
 *
 * Two lanes:
 *  1. SIM lane (preferred for the 10 interactive modules). We first classify the
 *     query to ONE sim id with a cheap keyword scorer; if that's ambiguous we let
 *     the model arbitrate. When a sim is chosen we ask gemini for RICH structured
 *     `SceneContent` — a real title, 3-5 technical phases (1:1 with narration
 *     cues), sensible initial `params` matching that sim's controls, and a
 *     representative LaTeX `equation` for the phenomenon.
 *  2. ARCHETYPE lane (fallback). When nothing maps to a sim, we keep the existing
 *     hand-tuned archetype planning path unchanged.
 *
 * Planning is the cheapest step in the budget, so thinking stays LOW for a little
 * structure without burning latency. On mode === "mutate" we feed the prior plan
 * back in and ask the model to evolve it rather than invent a fresh scene.
 */
import { Type } from "@google/genai";
import {
  generate,
  ThinkingLevel,
  type Schema,
  type GenOptions,
} from "@/lib/gemini";
import type {
  ScenePlan,
  ScenePhase,
  Renderer,
  SceneType,
  SceneContentItem,
  SceneContent,
  Familiarity,
} from "@/lib/types";
import { SIM_IDS, type SimId } from "@/lib/sims";
import { isSceneType } from "./archetypes";

// ── sim ids + content contract ────────────────────────────────────────────
// `SimId`/`SIM_IDS` are the canonical registry's (lib/sims) source of truth and
// `SceneContent` is the framework's contract (lib/types) — both re-exported here
// so the route imports the sim vocabulary from one place (the orchestrator).
export type { SimId, SceneContent };
export { SIM_IDS };

export function isSimId(value: unknown): value is SimId {
  return (SIM_IDS as readonly string[]).includes(value as string);
}

/** One narration-aligned beat of a sim (the SceneContent phase shape). */
type ScenePhaseContent = SceneContent["phases"][number];

/** A planned interactive sim: which module + the rich content that drives it. */
export interface SimPlan {
  kind: "sim";
  simId: SimId;
  content: SceneContent;
  /** Phase intents kept so the narration agent can speak each beat. */
  phases: ScenePhase[];
}

/** The orchestrator returns either an archetype scene plan or a sim plan. */
export type OrchestratorResult =
  | ({ kind: "archetype" } & ScenePlan)
  | SimPlan;

export function isSimPlan(r: OrchestratorResult): r is SimPlan {
  return r.kind === "sim";
}

// ── familiarity tuning ──────────────────────────────────────────────────────
// One directive, injected into BOTH the archetype plan prompt and the sim
// content prompt, so the model genuinely changes phase count, label/value
// technicality, and framing by level. "familiar" is the unmodified default.
const FAMILIARITY_PLAN: Record<Familiarity, string> = {
  novice:
    "Viewer level: NOVICE. Keep it to 2-3 phases. Use plain, everyday labels (no jargon as the title). Frame the whole scene around a single concrete everyday analogy. Use rounded, illustrative values (e.g. 'about half', '~4%', 'twice as fast') rather than exact figures. Skip the formal equation framing.",
  familiar: "",
  expert:
    "Viewer level: EXPERT. Use 4-5 phases for full mechanistic depth. Labels and sublabels must be the precise technical terms of the field. Values must be exact quantities with correct units and symbols. Emphasize the governing equation/relation and the precise variables it relates.",
};

const FAMILIARITY_SIM: Record<Familiarity, string> = {
  novice:
    "Viewer level: NOVICE. Use exactly 3 phases. Phase labels are plain everyday words, not jargon. Values are rounded and illustrative, not precise figures. The equation can stay but pick the simplest correct form.",
  familiar: "",
  expert:
    "Viewer level: EXPERT. Use 4-5 phases. Phase labels are precise field-standard technical terms; values are exact quantities with correct units/symbols. The equation must be the full governing relation for the phenomenon.",
};

/** Append the level directive to a prompt; "familiar" is a no-op default. */
function withFamiliarity(
  prompt: string,
  table: Record<Familiarity, string>,
  familiarity: Familiarity,
): string {
  const directive = table[familiarity];
  return directive ? `${prompt}\n\n${directive}` : prompt;
}

// ── sim classification ──────────────────────────────────────────────────────
// A whole-word keyword scorer routes the common phrasings deterministically (no
// model round-trip, no latency) and the highest score wins. If the top score is
// weak/tied we hand the decision to the model. Keywords are weighted: a precise
// term (>=5 chars) scores 2, a short one scores 1, so "phantom traffic jam" beats
// an incidental "wave" mention.
interface SimSpec {
  id: SimId;
  /** One-line description used in the model classifier prompt. */
  hint: string;
  /** Whole-word keywords that route a free-text query here. */
  keywords: string[];
}

const SIM_SPECS: SimSpec[] = [
  {
    id: "traffic-jam",
    hint: "phantom/stop-and-go traffic jams, car following, congestion waves, flow density",
    keywords: [
      "traffic",
      "jam",
      "congestion",
      "phantom",
      "highway",
      "cars",
      "car",
      "freeway",
      "stop",
      "go",
      "commute",
    ],
  },
  {
    id: "waves",
    hint: "standing/traveling waves, interference, superposition, resonance, harmonics, strings",
    keywords: [
      "wave",
      "waves",
      "standing",
      "interference",
      "superposition",
      "resonance",
      "harmonic",
      "harmonics",
      "vibration",
      "string",
      "amplitude",
      "wavelength",
      "ripple",
    ],
  },
  {
    id: "particles",
    hint: "diffusion, Brownian motion, ideal gas, entropy, thermal mixing, kinetic theory",
    keywords: [
      "diffusion",
      "gas",
      "brownian",
      "entropy",
      "thermal",
      "kinetic",
      "temperature",
      "pressure",
      "mixing",
      "ideal",
      "random",
      "walk",
    ],
  },
  {
    id: "orbital",
    hint: "orbits, gravity, Kepler, two-body, pendulum, planetary motion, escape velocity",
    keywords: [
      "orbit",
      "orbital",
      "gravity",
      "gravitational",
      "kepler",
      "pendulum",
      "planet",
      "planetary",
      "satellite",
      "escape",
      "ellipse",
      "moon",
    ],
  },
  {
    id: "neural-net",
    hint: "neural networks, attention, CNNs, classifiers, backprop, transformers, layers learning",
    keywords: [
      "neural",
      "network",
      "attention",
      "cnn",
      "classify",
      "classifier",
      "classification",
      "backprop",
      "backpropagation",
      "transformer",
      "perceptron",
      "mnist",
      "neuron",
      "layer",
      "weights",
      "gradient",
    ],
  },
  {
    id: "epidemic",
    hint: "SIR/SEIR epidemic spread, virus, infection, contagion, R0, herd immunity, outbreak",
    keywords: [
      "epidemic",
      "virus",
      "infection",
      "infected",
      "contagion",
      "spread",
      "spreading",
      "outbreak",
      "pandemic",
      "sir",
      "seir",
      "herd",
      "immunity",
      "disease",
      "vaccine",
      "contagious",
      "transmission",
    ],
  },
  {
    id: "flow-field",
    hint: "fluid flow, vector/velocity fields, wind, turbulence, advection, streamlines, curl",
    keywords: [
      "fluid",
      "flow",
      "wind",
      "vector",
      "field",
      "turbulence",
      "turbulent",
      "advection",
      "streamline",
      "streamlines",
      "curl",
      "vortex",
      "current",
      "aerodynamics",
    ],
  },
  {
    id: "signal",
    hint: "AC/RC/RL circuits, Fourier series, action potential, filters, oscillation, waveforms",
    keywords: [
      "circuit",
      "fourier",
      "signal",
      "capacitor",
      "resistor",
      "inductor",
      "voltage",
      "potential",
      "filter",
      "frequency",
      "spectrum",
      "oscillator",
      "alternating",
      "rectifier",
      "spike",
      "neuron",
      "charge",
      "charging",
      "discharge",
      "waveform",
      "rc",
      "rl",
      "ac",
      "dc",
    ],
  },
  {
    id: "algorithm",
    hint: "graph/sorting algorithms: Dijkstra, BFS/DFS, A*, quicksort, mergesort, traversal",
    keywords: [
      "dijkstra",
      "sort",
      "sorting",
      "bfs",
      "dfs",
      "astar",
      "quicksort",
      "mergesort",
      "bubble",
      "traversal",
      "shortest",
      "pathfinding",
      "search",
      "heap",
      "tree",
      "recursion",
    ],
  },
  {
    id: "molecules",
    hint: "chemical reactions, molecular bonds, equilibrium, collisions, catalysts, kinetics",
    keywords: [
      "reaction",
      "molecule",
      "molecular",
      "bond",
      "bonds",
      "chemical",
      "chemistry",
      "equilibrium",
      "catalyst",
      "collision",
      "reactant",
      "product",
      "atom",
      "compound",
      "covalent",
    ],
  },
];

/** Whole-word keyword score for a sim spec against a query. */
function simScore(words: Set<string>, spec: SimSpec): number {
  let s = 0;
  for (const kw of spec.keywords) {
    if (words.has(kw)) s += kw.length >= 5 ? 2 : 1;
  }
  return s;
}

const SIM_KEYWORD_THRESHOLD = 2;
const SIM_KEYWORD_DECISIVE = 4;

const CLASSIFY_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["simId"],
  properties: {
    simId: {
      type: Type.STRING,
      // "none" lets the model decline so we fall back to archetypes cleanly.
      enum: [...SIM_IDS, "none"],
      description:
        "Which interactive simulation module best fits the query, or 'none' " +
        "if the idea is not a good fit for any of them.",
    },
  },
  propertyOrdering: ["simId"],
};

const CLASSIFY_SYSTEM = `You route a user's question to ONE interactive physics/CS simulation module, or decline.

Modules:
${SIM_SPECS.map((s) => `- ${s.id}: ${s.hint}`).join("\n")}

Pick the single module whose phenomenon the question is fundamentally about. If the question is genuinely better served by a generic diagram (a process flow, a comparison, a timeline) and is NOT one of these phenomena, return "none". Prefer a real module over "none" whenever the topic clearly is one of the phenomena above.`;

/**
 * Classify a query to a sim id. Fast path: a decisive keyword score wins with no
 * model call. Otherwise the model arbitrates (cheap, structured). Returns null
 * to fall back to the archetype lane.
 */
async function classifySim(
  query: string,
  abortSignal?: AbortSignal,
): Promise<SimId | null> {
  const words = new Set(query.toLowerCase().match(/[a-z]+/g) ?? []);

  // Generative image synthesis (text-to-image) has no matching sim, and the
  // neural-net classifier is the wrong picture for it. Force the archetype path
  // so the generation pipeline (prompt -> encoder -> diffusion -> image) renders
  // as a clean flow instead of a digit classifier.
  const q = query.toLowerCase();
  const imageGen =
    /text[- ]?to[- ]?image|dall[- ]?e|midjourney|stable diffusion|diffusion model/.test(
      q,
    ) ||
    (/\b(image|picture|photo|artwork)\b/.test(q) &&
      /\b(generat|creat|synthesi|prompt|produce)/.test(q));
  if (imageGen) return null;

  let best: SimSpec | undefined;
  let bestScore = 0;
  let runnerUp = 0;
  for (const spec of SIM_SPECS) {
    const s = simScore(words, spec);
    if (s > bestScore) {
      runnerUp = bestScore;
      bestScore = s;
      best = spec;
    } else if (s > runnerUp) {
      runnerUp = s;
    }
  }

  // Decisive keyword win: take it, skip the model.
  if (best && bestScore >= SIM_KEYWORD_DECISIVE && bestScore > runnerUp) {
    return best.id;
  }

  // Weak/ambiguous keyword signal: let the model arbitrate.
  try {
    const text = await generate(`Question: "${query}"`, {
      systemInstruction: CLASSIFY_SYSTEM,
      responseSchema: CLASSIFY_SCHEMA,
      thinkingLevel: ThinkingLevel.LOW,
      temperature: 0,
      abortSignal,
    });
    const parsed = JSON.parse(text) as { simId?: unknown };
    if (isSimId(parsed.simId)) return parsed.simId;
    if (parsed.simId === "none") {
      // Model declined; trust a moderate keyword signal as a tiebreak.
      return best && bestScore >= SIM_KEYWORD_THRESHOLD ? best.id : null;
    }
  } catch {
    // Model failed: fall back to the keyword signal if it's at all present.
    return best && bestScore >= SIM_KEYWORD_THRESHOLD ? best.id : null;
  }
  return best && bestScore >= SIM_KEYWORD_THRESHOLD ? best.id : null;
}

// ── sim content generation (rich, technical) ────────────────────────────────
// Per-sim guidance: the canonical control params (keys MUST match the sim's
// exposed controls) and a representative governing equation. The model is told
// to honor these so the emitted `params`/`equation` actually drive the module.
interface SimContentSpec {
  /** Sentence describing the phenomenon + what each phase should build toward. */
  brief: string;
  /** The control params this sim exposes, with sensible defaults + range hints. */
  paramHints: string;
  /** Canonical initial params if the model omits/garbles them. */
  defaultParams: Record<string, number>;
  /** Canonical LaTeX equation fallback. */
  equation: string;
}

const SIM_CONTENT_SPECS: Record<SimId, SimContentSpec> = {
  "traffic-jam": {
    brief:
      "Phantom traffic jams: identical cars on a ring road, each following the one ahead. A tiny perturbation amplifies backward into a stop-and-go wave with no obstacle. Build from free flow -> perturbation -> backward-propagating jam wave -> dissipation.",
    paramHints:
      "cars (number of vehicles, ~22), density (0..1 occupancy), sensitivity (driver reaction gain, ~1.5), vmax (target speed, ~30)",
    defaultParams: { cars: 22, density: 0.45, sensitivity: 1.5, vmax: 30 },
    equation:
      "\\dot v_n = \\alpha\\,\\big(V(\\Delta x_n) - v_n\\big)",
  },
  waves: {
    brief:
      "Standing waves: two equal traveling waves moving in opposite directions superpose into a stationary pattern of nodes and antinodes. Build from a single traveling wave -> the counter-propagating wave -> their superposition -> the resonant standing pattern.",
    paramHints:
      "amplitude (0..1, ~0.6), frequency (Hz, ~2), wavelength (relative, ~1), harmonic (mode number n, integer 1..5)",
    defaultParams: { amplitude: 0.6, frequency: 2, wavelength: 1, harmonic: 3 },
    equation:
      "y(x,t) = 2A\\,\\sin(kx)\\,\\cos(\\omega t)",
  },
  particles: {
    brief:
      "Diffusion of a gas: particles start concentrated in one half, then random thermal motion spreads them until the box is uniform — entropy rising toward equilibrium. Build from the partitioned state -> first collisions -> net flux down the gradient -> uniform equilibrium.",
    paramHints:
      "particles (count, ~400), temperature (sets speed, ~1), partition (1 = wall present, 0 = removed)",
    defaultParams: { particles: 400, temperature: 1, partition: 0 },
    equation:
      "\\frac{\\partial c}{\\partial t} = D\\,\\nabla^2 c",
  },
  orbital: {
    brief:
      "Orbital motion under gravity: a body's velocity and the inward gravitational pull combine into a closed elliptical orbit (Kepler). Build from the central mass -> initial tangential velocity -> the curving free-fall path -> the stable ellipse with conserved areal velocity.",
    paramHints:
      "mass (central mass, ~1), velocity (initial tangential speed, ~1.1), radius (initial distance, ~1), eccentricity (0..0.9)",
    defaultParams: { mass: 1, velocity: 1.1, radius: 1, eccentricity: 0.4 },
    equation:
      "F = \\frac{G\\,m_1 m_2}{r^2}",
  },
  "neural-net": {
    brief:
      "A neural network classifying an input: activations flow forward through layers, each unit a weighted sum passed through a nonlinearity, until the output layer fires the predicted class. Build from the input vector -> hidden layer activations -> the nonlinearity -> the softmax output / prediction.",
    paramHints:
      "layers (depth, ~4), neurons (width per layer, ~6), learningRate (~0.05), epoch (training step, integer)",
    defaultParams: { layers: 4, neurons: 6, learningRate: 0.05, epoch: 0 },
    equation:
      "a^{(l)} = \\sigma\\!\\big(W^{(l)} a^{(l-1)} + b^{(l)}\\big)",
  },
  epidemic: {
    brief:
      "SIR epidemic spread: a population of agents moves between Susceptible, Infected, and Recovered. Contact spreads infection at rate beta; infected recover at rate gamma. Build from the seed infection -> exponential growth (R0>1) -> the epidemic peak -> burnout / herd immunity.",
    paramHints:
      "population (agents, ~500), beta (infection rate, ~0.4), gamma (recovery rate, ~0.1), r0 (beta/gamma, ~4)",
    defaultParams: { population: 500, beta: 0.4, gamma: 0.1, r0: 4 },
    equation:
      "\\frac{dI}{dt} = \\beta\\,\\frac{S I}{N} - \\gamma I",
  },
  "flow-field": {
    brief:
      "A fluid velocity field: tracer particles advect along a vector field, tracing streamlines that reveal vortices, shear, and turbulent mixing. Build from the static vector field -> seeded tracers -> streamlines forming -> a vortex / turbulent regime.",
    paramHints:
      "particles (tracer count, ~600), viscosity (0..1, ~0.2), scale (field spatial scale, ~1.5), speed (advection rate, ~1)",
    defaultParams: { particles: 600, viscosity: 0.2, scale: 1.5, speed: 1 },
    equation:
      "\\frac{\\partial \\mathbf{u}}{\\partial t} + (\\mathbf{u}\\cdot\\nabla)\\mathbf{u} = -\\frac{1}{\\rho}\\nabla p + \\nu\\nabla^2\\mathbf{u}",
  },
  signal: {
    brief:
      "An RC circuit charging: a step voltage drives current through a resistor into a capacitor; the capacitor voltage rises exponentially with time constant tau = RC. Build from the open circuit -> the step input -> exponential charging -> the steady state at the source voltage.",
    paramHints:
      "resistance (ohms, ~1000), capacitance (farads, ~1e-6), voltage (source volts, ~5), frequency (Hz for AC drive, ~1)",
    defaultParams: { resistance: 1000, capacitance: 0.000001, voltage: 5, frequency: 1 },
    equation:
      "V_C(t) = V_0\\big(1 - e^{-t/RC}\\big)",
  },
  algorithm: {
    brief:
      "Dijkstra's shortest-path search on a weighted graph: tentative distances relax outward from the source, the closest unvisited node is finalized each step, until the target's shortest path is locked in. Build from the source -> frontier expansion -> edge relaxation -> the final shortest path.",
    paramHints:
      "nodes (graph size, ~8), edges (connections, ~14), source (start index, 0), speed (steps/sec, ~1)",
    defaultParams: { nodes: 8, edges: 14, source: 0, speed: 1 },
    equation:
      "d(v) = \\min\\big(d(v),\\; d(u) + w(u,v)\\big)",
  },
  molecules: {
    brief:
      "A reversible chemical reaction reaching equilibrium: reactant molecules collide with enough energy to cross the activation barrier and form products; the forward and reverse rates balance at equilibrium. Build from separated reactants -> energetic collisions -> bond formation (products) -> dynamic equilibrium.",
    paramHints:
      "molecules (count, ~80), temperature (sets collision energy, ~1), kForward (forward rate const, ~0.5), kReverse (reverse rate const, ~0.2)",
    defaultParams: { molecules: 80, temperature: 1, kForward: 0.5, kReverse: 0.2 },
    equation:
      "K_{eq} = \\frac{[\\text{products}]}{[\\text{reactants}]} = \\frac{k_f}{k_r}",
  },
};

const CONTENT_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["title", "phases", "equation", "params"],
  properties: {
    title: {
      type: Type.STRING,
      description: "Specific, technical title for the simulation, max 6 words.",
    },
    phases: {
      type: Type.ARRAY,
      description:
        "3 to 5 ordered phases that build the explanation, EXACTLY one per " +
        "narration beat. Each is a concrete on-screen moment.",
      items: {
        type: Type.OBJECT,
        required: ["label", "value"],
        properties: {
          label: {
            type: Type.STRING,
            description:
              "Concrete on-screen title for this beat, 1-5 words " +
              "(e.g. 'Free flow', 'Perturbation', 'Backward jam wave').",
          },
          sublabel: {
            type: Type.STRING,
            description:
              "Optional uppercase mono category tag, <=2 words " +
              "(e.g. 'EQUILIBRIUM', 'STEP 1', 'PEAK').",
          },
          value: {
            type: Type.STRING,
            description:
              "Short technical readout for this beat: a quantity with units " +
              "or a symbol (e.g. 'R0 = 4', 'τ = RC', 'v = 0', 'n = 3'). " +
              "Empty string only if genuinely none applies.",
          },
        },
        propertyOrdering: ["label", "sublabel", "value"],
      },
    },
    params: {
      type: Type.OBJECT,
      description:
        "Initial control values for THIS simulation. Keys MUST be the exact " +
        "control names listed for the sim; values are numbers in the stated " +
        "sensible ranges.",
      // Free-form numeric map: the model fills the sim's controls. We validate
      // + clamp against the sim's defaultParams after parsing.
      properties: {},
    },
    equation: {
      type: Type.STRING,
      description:
        "A representative governing equation for the phenomenon as a LaTeX " +
        "string (no surrounding $; e.g. 'y(x,t) = 2A\\\\sin(kx)\\\\cos(\\\\omega t)').",
    },
  },
  propertyOrdering: ["title", "phases", "params", "equation"],
};

const CONTENT_SYSTEM = `You are the content agent for Mira, a generative visualization engine in the spirit of Bartosz Ciechanowski and 3Blue1Brown. You are filling an INTERACTIVE simulation module with rigorous, technical structured content — not writing animation code.

Given the user's question and the chosen simulation, produce:
- title: a specific, technical name for what's being shown.
- phases: 3-5 ordered beats that BUILD the idea from setup to payoff, EXACTLY one per spoken narration line. Each label is the concrete on-screen moment; value is a real quantity/symbol with units when it sharpens the beat.
- params: the simulation's INITIAL control values. Use ONLY the control names given for this sim, with numbers in the stated ranges.
- equation: the governing relation as a clean LaTeX string (no surrounding $ signs).

Be genuinely technical and correct — real physics/CS, real symbols, real units. No filler.`;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

interface RawContent {
  title?: unknown;
  phases?: unknown;
  params?: unknown;
  equation?: unknown;
}

/** Coerce model params to a clean numeric map seeded with the sim's defaults. */
function coerceParams(
  raw: unknown,
  defaults: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = { ...defaults };
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      // Only honor keys the sim actually exposes; ignore hallucinated controls.
      if (!(k in defaults)) continue;
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
  }
  return out;
}

function clampDuration(ms: unknown): number {
  const n = typeof ms === "number" && Number.isFinite(ms) ? ms : 5000;
  return Math.min(9000, Math.max(2500, Math.round(n)));
}

const PHASE_MS = 5500;

/** Build a SimPlan from the model's raw content, with robust fallbacks. */
function normalizeSimContent(
  raw: RawContent,
  simId: SimId,
  query: string,
): SimPlan {
  const spec = SIM_CONTENT_SPECS[simId];
  const title = str(raw.title) || query.slice(0, 48) || simId;

  const rawPhases = Array.isArray(raw.phases) ? raw.phases : [];
  const phaseContent: ScenePhaseContent[] = [];
  const phases: ScenePhase[] = [];

  for (let i = 0; i < rawPhases.length && phaseContent.length < 5; i++) {
    const p = rawPhases[i];
    if (!p || typeof p !== "object") continue;
    const obj = p as Record<string, unknown>;
    const label = str(obj.label);
    if (!label) continue;
    const sublabel = str(obj.sublabel) || undefined;
    const value = str(obj.value) || undefined;
    phaseContent.push({ label, sublabel, value });
    phases.push({
      id: `sim-${simId}-${phaseContent.length}`,
      intent: value ? `${label} (${value})` : label,
      renderer: "2d",
      approxDurationMs: clampDuration(PHASE_MS),
    });
  }

  // Guarantee at least 3 beats so an interactive sim always reads as a build.
  if (phaseContent.length < 3) {
    const fillers: ScenePhaseContent[] = [
      { label: "Setup", sublabel: "INITIAL" },
      { label: "Dynamics", sublabel: "EVOLVE" },
      { label: "Steady state", sublabel: "RESULT" },
    ];
    for (let i = phaseContent.length; i < 3; i++) {
      phaseContent.push(fillers[i]);
      phases.push({
        id: `sim-${simId}-${i + 1}`,
        intent: fillers[i].label,
        renderer: "2d",
        approxDurationMs: PHASE_MS,
      });
    }
  }

  const content: SceneContent = {
    title,
    phases: phaseContent,
    params: coerceParams(raw.params, spec.defaultParams),
    equation: str(raw.equation) || spec.equation,
  };

  return { kind: "sim", simId, content, phases };
}

/** Deterministic sim content when the model is unavailable or fails. */
function defaultSimContent(simId: SimId, query: string): SimPlan {
  const spec = SIM_CONTENT_SPECS[simId];
  return normalizeSimContent(
    { title: query.slice(0, 48) || simId, phases: [], equation: spec.equation },
    simId,
    query,
  );
}

/**
 * Ask the model for rich, technical SceneContent for a chosen sim. Falls back to
 * the sim's canonical default content on any failure so the sim still drives.
 */
async function planSimContent(
  simId: SimId,
  query: string,
  familiarity: Familiarity,
  abortSignal?: AbortSignal,
): Promise<SimPlan> {
  const spec = SIM_CONTENT_SPECS[simId];
  const basePrompt = `User question: "${query}"
Chosen simulation: ${simId}

What it shows: ${spec.brief}

Control params for this sim (use these EXACT keys): ${spec.paramHints}

Produce the technical content. Phases must build the idea and be 1:1 with the spoken narration. The equation should be the governing relation for this phenomenon.`;
  const prompt = withFamiliarity(basePrompt, FAMILIARITY_SIM, familiarity);

  let text: string;
  try {
    text = await generate(prompt, {
      systemInstruction: CONTENT_SYSTEM,
      responseSchema: CONTENT_SCHEMA,
      thinkingLevel: ThinkingLevel.LOW,
      temperature: 0.4,
      abortSignal,
    });
  } catch {
    return defaultSimContent(simId, query);
  }

  let raw: RawContent;
  try {
    raw = JSON.parse(text) as RawContent;
  } catch {
    return defaultSimContent(simId, query);
  }
  return normalizeSimContent(raw, simId, query);
}

// ── archetype plan (unchanged fallback lane) ────────────────────────────────
const PLAN_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["title", "sceneType", "phases"],
  properties: {
    title: {
      type: Type.STRING,
      description: "Short title for the whole visualization, max 6 words.",
    },
    sceneType: {
      type: Type.STRING,
      enum: ["flow", "cycle", "layered", "timeline", "comparison"],
      description:
        "Which hand-tuned visual archetype best fits the explanation. " +
        "'flow' = a process / pipeline / cause→effect chain of distinct stages connected by arrows. " +
        "'cycle' = a repeating loop of stages (heartbeat, water cycle, request/response). " +
        "'layered' = signals propagating through stacked layers / a hierarchy / a network. " +
        "'timeline' = an ordered sequence of steps, a protocol handshake, or a history along a track. " +
        "'comparison' = comparing quantities or magnitudes (sizes, rates, shares).",
    },
    phases: {
      type: Type.ARRAY,
      description:
        "2 to 5 ordered phases that build the explanation. EXACTLY one per beat the narration will speak.",
      items: {
        type: Type.OBJECT,
        required: ["id", "intent", "label", "renderer", "approxDurationMs"],
        properties: {
          id: {
            type: Type.STRING,
            description: "kebab-case stable id, e.g. 'setup' or 'rate-cut'.",
          },
          intent: {
            type: Type.STRING,
            description: "One line: what this phase shows visually.",
          },
          label: {
            type: Type.STRING,
            description:
              "Short on-screen title for THIS beat's element (the node/stage/layer/bar). 1-4 words, concrete (e.g. 'SA Node', 'Light Reaction', 'SYN packet').",
          },
          sublabel: {
            type: Type.STRING,
            description:
              "Optional uppercase category tag for this element, <=2 words (e.g. 'trigger', 'input', 'step 1').",
          },
          value: {
            type: Type.STRING,
            description:
              "Optional short readout/value shown on the element (e.g. '60 bpm', '4.75%', 'ATP', '12 ms'). Empty if none.",
          },
          magnitude: {
            type: Type.NUMBER,
            description:
              "For sceneType 'comparison' ONLY: this bar's height as 0..1 relative to the others. Ignored otherwise.",
          },
          renderer: {
            type: Type.STRING,
            enum: ["2d", "3d"],
            description: "'2d' for flows/graphs/charts, '3d' for spatial scenes.",
          },
          approxDurationMs: {
            type: Type.INTEGER,
            description: "How long this phase plays, 3000-9000 ms.",
          },
        },
        propertyOrdering: [
          "id",
          "intent",
          "label",
          "sublabel",
          "value",
          "magnitude",
          "renderer",
          "approxDurationMs",
        ],
      },
    },
  },
  propertyOrdering: ["title", "sceneType", "phases"],
};

const SYSTEM = `You are the planning agent for Mira, a generative visualization engine in the spirit of Bartosz Ciechanowski and 3Blue1Brown.

Given a user's question, produce a concise scene plan. Mira renders the scene with a small set of beautiful, hand-tuned ARCHETYPES — you do NOT write animation code; you pick the archetype and supply structured per-beat content that fills it.

First pick the ONE archetype that fits the idea:
- flow: a process / pipeline / cause→effect chain of distinct stages (the Fed rate cut rippling outward).
- cycle: a repeating loop of stages (heartbeat, water cycle, the request/response cycle).
- layered: signals propagating through stacked layers, a hierarchy, or a network (a neural net classifying).
- timeline: an ordered sequence, a protocol handshake, or a history along a track (the TCP three-way handshake).
- comparison: comparing quantities or magnitudes (relative sizes, rates, market shares).

Then give 2-5 ordered phases — EXACTLY one per beat the narration will speak (the spoken cue count equals the phase count). Each phase contributes ONE element to the chosen archetype.

Rules:
- Each phase's \`label\` is the concrete on-screen title of its element: 1-4 words ("SA Node", "Light Reaction", "SYN packet", "Cooler air sinks"). Never abstract.
- \`intent\` is one visually concrete line about what that beat shows.
- For 'comparison', set each phase's \`magnitude\` (0..1) to the bar's relative height. For other archetypes omit it.
- Use \`value\` for a crisp readout when it sharpens the idea ("60 bpm", "4.75%", "ATP"); otherwise leave it empty.
- approxDurationMs is the on-screen time for that beat, 3000-9000ms each.
- Phase ids are short, kebab-case, stable.
- Renderer is "2d" for these archetypes (always pick "2d"); "3d" only for a genuinely spatial idea.`;

const VALID_RENDERERS: Renderer[] = ["2d", "3d"];

function coerceRenderer(value: unknown): Renderer {
  return VALID_RENDERERS.includes(value as Renderer)
    ? (value as Renderer)
    : "2d";
}

function coerceSceneType(value: unknown): SceneType {
  return isSceneType(value) ? value : "flow";
}

interface RawPlan {
  title?: unknown;
  sceneType?: unknown;
  phases?: unknown;
}

function normalizePlan(raw: RawPlan, query: string): ScenePlan {
  const id = `scene-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  const title =
    typeof raw.title === "string" && raw.title.trim()
      ? raw.title.trim()
      : query.slice(0, 48);
  const sceneType = coerceSceneType(raw.sceneType);

  const rawPhases = Array.isArray(raw.phases) ? raw.phases : [];
  const phases: ScenePhase[] = [];
  const content: SceneContentItem[] = [];

  for (let i = 0; i < rawPhases.length && phases.length < 5; i++) {
    const p = rawPhases[i];
    if (!p || typeof p !== "object") continue;
    const obj = p as Record<string, unknown>;
    const intent = str(obj.intent) || str(obj.label);
    if (!intent) continue;
    const phaseId = str(obj.id) || `phase-${phases.length + 1}`;
    phases.push({
      id: phaseId,
      intent,
      renderer: coerceRenderer(obj.renderer),
      approxDurationMs: clampDuration(obj.approxDurationMs),
    });
    const magnitude =
      typeof obj.magnitude === "number" && Number.isFinite(obj.magnitude)
        ? obj.magnitude
        : undefined;
    content.push({
      label: str(obj.label) || intent,
      sublabel: str(obj.sublabel) || undefined,
      value: str(obj.value) || undefined,
      magnitude,
    });
  }

  if (phases.length === 0) {
    phases.push({
      id: "main",
      intent: query,
      renderer: "2d",
      approxDurationMs: 6000,
    });
    content.push({ label: title });
  }

  return { id, title, sceneType, content, phases };
}

/** All phases of a plan share one renderer for the render host. */
export function planRenderer(plan: ScenePlan): Renderer {
  return plan.phases[0]?.renderer ?? "2d";
}

export interface PlanInput {
  query: string;
  abortSignal?: AbortSignal;
  /** Present on mutate: the prior plan being morphed. */
  previousPlan?: ScenePlan;
  /** Viewer level; tunes phase count + technicality. Defaults to "familiar". */
  familiarity?: Familiarity;
}

/**
 * Plan an ARCHETYPE scene (the fallback lane). Structured title + sceneType +
 * per-phase content, with mutate morphing the prior plan and familiarity tuning
 * the depth/technicality.
 */
export async function planScene(input: PlanInput): Promise<ScenePlan> {
  const { query, abortSignal, previousPlan } = input;
  const familiarity = input.familiarity ?? "familiar";

  const basePrompt = previousPlan
    ? `The user is iterating on an existing visualization. Morph it; do not start over.

Existing plan (JSON):
${JSON.stringify(
        {
          title: previousPlan.title,
          sceneType: previousPlan.sceneType,
          phases: previousPlan.phases.map((p, i) => ({
            ...p,
            label: previousPlan.content[i]?.label,
            sublabel: previousPlan.content[i]?.sublabel,
            value: previousPlan.content[i]?.value,
            magnitude: previousPlan.content[i]?.magnitude,
          })),
        },
        null,
        2,
      )}

Follow-up request: "${query}"

Return an evolved plan. Reuse phase ids where the beat carries over so the renderer can morph in place. Keep the same sceneType unless the follow-up clearly calls for a different archetype. Add, drop, or re-time phases only as the follow-up requires.`
    : `User question: "${query}"

Produce the scene plan.`;

  const prompt = withFamiliarity(basePrompt, FAMILIARITY_PLAN, familiarity);

  const opts: GenOptions = {
    systemInstruction: SYSTEM,
    responseSchema: PLAN_SCHEMA,
    thinkingLevel: ThinkingLevel.LOW,
    temperature: 0.4,
    abortSignal,
  };

  const text = await generate(prompt, opts);
  let raw: RawPlan;
  try {
    raw = JSON.parse(text) as RawPlan;
  } catch {
    raw = {};
  }
  const plan = normalizePlan(raw, query);

  // On mutate, preserve the morph relationship by reusing prior phase ids when
  // the model returned the same count but renamed them.
  if (previousPlan && plan.phases.length === previousPlan.phases.length) {
    plan.phases = plan.phases.map((p, i) => ({
      ...p,
      renderer: previousPlan.phases[i]?.renderer ?? p.renderer,
    }));
  }

  return plan;
}

// ── top-level entry: sim lane first, archetype lane fallback ────────────────
export interface OrchestrateInput {
  query: string;
  abortSignal?: AbortSignal;
  /** Present on mutate: the prior archetype plan being morphed. */
  previousPlan?: ScenePlan;
  /** Present on mutate: the prior sim, so a follow-up keeps the same module. */
  previousSimId?: SimId;
  /** Viewer level; tunes plan depth + narration. Defaults to "familiar". */
  familiarity?: Familiarity;
}

/**
 * Route a query to either an interactive SIM (the preferred path for the 10
 * modules) or a hand-tuned ARCHETYPE scene.
 *
 * MUTATE keeps the follow-up ON the prior topic's lane so it evolves rather than
 * jumping to an unrelated scene:
 *  - prior was a SIM   -> stay on that module, re-derive content for the new query.
 *  - prior was ARCHETYPE -> go straight to planScene with the prior plan as
 *    context (do NOT re-classify the follow-up into a different sim, which would
 *    drop the original topic).
 */
export async function orchestrate(
  input: OrchestrateInput,
): Promise<OrchestratorResult> {
  const { query, abortSignal, previousPlan, previousSimId } = input;
  const familiarity = input.familiarity ?? "familiar";

  // Mutate that started from a sim: stay on the same module, refresh content.
  if (previousSimId && isSimId(previousSimId)) {
    return planSimContent(previousSimId, query, familiarity, abortSignal);
  }

  // Mutate that started from an archetype: morph the prior plan in place. Skip
  // sim re-classification so the follow-up stays on the original topic.
  if (previousPlan) {
    const plan = await planScene({
      query,
      abortSignal,
      previousPlan,
      familiarity,
    });
    return { kind: "archetype", ...plan };
  }

  const simId = await classifySim(query, abortSignal);
  if (simId) {
    return planSimContent(simId, query, familiarity, abortSignal);
  }

  const plan = await planScene({ query, abortSignal, familiarity });
  return { kind: "archetype", ...plan };
}
