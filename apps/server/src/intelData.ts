/** Curated intel payloads — the "premium data" agents purchase. Deterministic, no external deps. */
export interface IntelPayload {
  topic: string;
  generatedAt: string;
  headlines: string[];
  note: string;
}

export function intelFor(topic: string): IntelPayload {
  return {
    topic,
    generatedAt: new Date().toISOString(),
    headlines: [
      `${topic}: developer activity snapshot`,
      `${topic}: liquidity and listings overview`,
      `${topic}: social sentiment digest`,
    ],
    note: "Premium intel feed (paid via x402 + ERC-7710 delegation)",
  };
}
