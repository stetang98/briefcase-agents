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
      "3 most decision-relevant findings as concise bullet points. Base every bullet on the " +
      "intel feed you receive; do NOT invent project names, token tickers, percentages, or " +
      "dates that are not in the feed — rephrase its findings in clear plain English. " +
      "If buy_intel returns an error, call it one more time; if it still fails, write the " +
      "3 bullet points from your own knowledge of the topic instead. " +
      "You are writing a section of a research brief, not chatting: never mention tools, " +
      "payments, errors, or apologies; never address the reader, ask questions, or offer " +
      "follow-ups — output only the findings.",
  },
  {
    name: "analyst",
    weight: 2,
    // CODE-GROUNDED in chief.ts: the chief performs the read_chain RPC reads
    // itself, passes the decoded numbers in the task, and verifies the output
    // quotes them (deterministic fallback otherwise). No tools in the loop —
    // a single round-trip writes the section, with one spare step.
    maxSteps: 2,
    toolNames: [],
    system:
      "You are Analyst, an on-chain data agent on the Briefcase research desk. The task " +
      "gives you live, already-decoded readings from the Base Sepolia TESTNET (chainId " +
      "84532). Write the on-chain signals section of a research brief: 2-4 sentences " +
      "quoting the given block height and gas price VERBATIM with their given units — " +
      "write numbers without thousands separators, never convert units, and never " +
      "attribute the data to Ethereum mainnet or any other network. Do not add protocol " +
      "claims the readings cannot support. Not a chat: no questions, offers, or apologies " +
      "to the reader. Keep it under 100 words.",
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
