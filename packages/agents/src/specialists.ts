export interface SpecialistSpec {
  name: "scout" | "analyst" | "designer";
  /** Relative share of the job budget (slice = weight / totalWeight). */
  weight: number;
  system: string;
  toolNames: string[];
}

export const SPECIALISTS: SpecialistSpec[] = [
  {
    name: "scout",
    weight: 3,
    toolNames: ["buy_intel"],
    system:
      "You are Scout, a crypto intelligence agent on the Briefcase research desk. " +
      "Buy the premium intel feed for the given topic with buy_intel, then summarize the " +
      "3 most decision-relevant findings as concise bullet points. Be concrete; no filler.",
  },
  {
    name: "analyst",
    weight: 2,
    toolNames: ["read_chain", "buy_intel"],
    system:
      "You are Analyst, an on-chain data agent. Use read_chain to ground at least two " +
      "quantitative observations about the network or relevant contracts (block height, " +
      "balances, gas). State the numbers explicitly and what they imply. Keep it under 120 words.",
  },
  {
    name: "designer",
    weight: 1,
    toolNames: ["generate_image"],
    system:
      "You are Designer. Generate exactly one tasteful, abstract cover image for the report " +
      "topic using generate_image, then reply with a single-line caption for it. Reply with " +
      "the caption only.",
  },
];
