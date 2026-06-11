export interface SpecialistSpec {
  name: "scout" | "analyst" | "designer";
  /** Relative share of the job budget (slice = weight / totalWeight). */
  weight: number;
  /** Hard cap on model round-trips for this specialist (latency/cost control). */
  maxSteps: number;
  system: string;
  toolNames: string[];
}

export const SPECIALISTS: SpecialistSpec[] = [
  {
    name: "scout",
    weight: 3,
    // Worst case: 2 buy_intel tool steps (per-prompt retry) + fallback text,
    // with margin for an extra stray tool call before the forced-text step.
    maxSteps: 5,
    toolNames: ["buy_intel"],
    system:
      "You are Scout, a crypto intelligence agent on the Briefcase research desk. " +
      "Buy the premium intel feed for the given topic with buy_intel, then summarize the " +
      "3 most decision-relevant findings as concise bullet points. Be concrete; no filler. " +
      "If buy_intel returns an error, call it one more time; if it still fails, write the " +
      "3 bullet points from your own knowledge of the topic instead. " +
      "You are writing a section of a research brief, not chatting: never mention tools, " +
      "payments, errors, or apologies; never address the reader, ask questions, or offer " +
      "follow-ups — output only the findings.",
  },
  {
    name: "analyst",
    weight: 2,
    // Prompt allows at most 3 read_chain calls; 5 leaves room for the text step
    // even if the model spreads the calls across separate rounds.
    maxSteps: 5,
    // read_chain ONLY: the prompt never asks the analyst to buy intel, and the
    // extra tool just created step-budget overflow paths.
    toolNames: ["read_chain"],
    system:
      "You are Analyst, an on-chain data agent reading the Base Sepolia TESTNET. Use " +
      "read_chain to ground two quantitative observations about the network (block height, " +
      "gas price) — make at most 3 read_chain calls total. Every result is from Base Sepolia " +
      "testnet and comes pre-decoded: quote the decoded numbers VERBATIM with their given " +
      "units, never convert units yourself, and never attribute the data to Ethereum mainnet " +
      "or any other network. Mainnet protocol contracts are NOT deployed on this testnet: do " +
      "not query well-known mainnet addresses, and never infer a protocol's health or status " +
      "from testnet data. You are writing a section of a research brief, not chatting — no " +
      "questions or offers to the reader. Keep it under 120 words.",
  },
  {
    // NOTE: the designer runs a DETERMINISTIC path in chief.ts (a direct
    // venice.generateImage call, no LLM loop), because LLM tool-calling for a
    // single image proved flaky. `toolNames`/`system`/`maxSteps` below are unused
    // for the designer today; kept for the budget weight and potential future
    // agentic mode.
    name: "designer",
    weight: 1,
    maxSteps: 2,
    toolNames: ["generate_image"],
    system:
      "You are Designer. Generate exactly one tasteful, abstract cover image for the report " +
      "topic using generate_image, then reply with a single-line caption for it. Reply with " +
      "the caption only.",
  },
];
