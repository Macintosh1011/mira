"use client";

/**
 * The empty-state detail beneath the wordmark: one line on what Mira does, plus
 * a small gallery of example queries grouped by field. Each example is a button
 * that fires that query straight into generation. Desktop and mobile are
 * deliberately separate layouts (a wide field grid vs. a single stacked column
 * of chips) rather than one reflowing grid.
 */

interface ExampleGroup {
  field: string;
  queries: string[];
}

// Curated examples per field. The first row leans on hand-authored topics
// (instant) so a first click always lands beautifully; the rest exercise live
// generation across domains.
const EXAMPLE_GROUPS: ExampleGroup[] = [
  {
    field: "Physics",
    queries: [
      "Why does a phantom traffic jam form with no obstacle",
      "Show how a pendulum's period depends on its length",
    ],
  },
  {
    field: "Biology",
    queries: [
      "Animate how an action potential travels down a neuron",
      "Show how DNA is transcribed into messenger RNA",
    ],
  },
  {
    field: "CS",
    queries: [
      "Explain how a neural network classifies a handwritten digit",
      "Visualize how a transformer attention head routes tokens",
    ],
  },
  {
    field: "Economics",
    queries: [
      "Animate how a Fed rate cut ripples through the mortgage market",
      "Show how compound interest outpaces simple interest over time",
    ],
  },
];

export default function LandingDetail({
  onPick,
}: {
  onPick: (query: string) => void;
}) {
  return (
    <div className="landing-detail">
      <p className="landing-lede">
        Ask anything. Mira narrates the answer over a live, animated diagram —
        built on the fly.
      </p>

      <div className="landing-gallery" role="list">
        {EXAMPLE_GROUPS.map((group) => (
          <div className="lg-group" role="listitem" key={group.field}>
            <div className="lg-field">{group.field}</div>
            <div className="lg-queries">
              {group.queries.map((q) => (
                <button
                  key={q}
                  className="lg-query"
                  onClick={() => onPick(q)}
                  title={q}
                >
                  <span className="lg-query-text">{q}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
