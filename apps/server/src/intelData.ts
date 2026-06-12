/** Curated intel payloads — the "premium data" agents purchase. Deterministic, no external deps. */
export interface IntelPayload {
  topic: string;
  generatedAt: string;
  headlines: string[];
  note: string;
}

// Qualitative, topic-agnostic findings: full sentences the scout can summarize
// into clean bullets. Deliberately NO fabricated hard numbers, tickers, or
// partnerships — those would read as wrong for a real protocol. The signals are
// operational and defensible for any topic, which is what a research desk feed
// looks like.
export function intelFor(topic: string): IntelPayload {
  return {
    topic,
    generatedAt: new Date().toISOString(),
    headlines: [
      `Developer activity around ${topic} has stayed steady this cycle, with contributors concentrating on protocol tooling, integration SDKs, and audit follow-ups rather than core protocol rewrites.`,
      `Liquidity for ${topic} spans several major venues with broadly stable spreads, and integration and listing coverage keeps widening, though depth remains concentrated in the top markets.`,
      `Community sentiment toward ${topic} skews constructive, led by builders and integrators and centered on roadmap execution and ecosystem incentives rather than short-term price action.`,
    ],
    note: "Premium intel feed (paid via x402 + ERC-7710 delegation)",
  };
}
