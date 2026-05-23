/** Demo queries from the README — single source of truth for the gallery. */
export interface ExampleQuery {
  domain: string;
  query: string;
  accent: "yellow" | "green" | "blue" | "terra";
}

export const EXAMPLE_QUERIES: ExampleQuery[] = [
  {
    domain: "Finance",
    query: "Animate how a Fed rate cut ripples through the mortgage market.",
    accent: "terra",
  },
  {
    domain: "Machine Learning",
    query: "Visualize how a transformer attention head attends across a sentence.",
    accent: "blue",
  },
  {
    domain: "Physics",
    query: "Show what happens to a star's core when it collapses into a black hole.",
    accent: "yellow",
  },
  {
    domain: "Algorithms",
    query: "Show how Dijkstra's algorithm finds the shortest path.",
    accent: "green",
  },
];
