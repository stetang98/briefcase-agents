import { describe, it, expect } from "vitest";
import { intelFor } from "../src/intelData.js";

describe("intelFor", () => {
  it("returns three findings that name the topic", () => {
    const intel = intelFor("uniswap");
    expect(intel.topic).toBe("uniswap");
    expect(intel.headlines).toHaveLength(3);
    for (const h of intel.headlines) expect(h).toContain("uniswap");
  });

  it("returns coherent multi-clause findings, not bare labels (so the model has real material to summarize)", () => {
    // The old payload was just `${topic}: developer activity snapshot` — too thin
    // for the model to summarize, so it hallucinated garbage. Real findings are
    // full sentences with substance.
    for (const h of intelFor("base").headlines) {
      expect(h.trim().split(/\s+/).length).toBeGreaterThan(12);
      expect(h).toMatch(/[.!]$/); // ends like a sentence
    }
  });

  it("covers distinct signal categories (dev activity, liquidity, sentiment)", () => {
    const joined = intelFor("arbitrum").headlines.join(" ").toLowerCase();
    expect(joined).toMatch(/develop|contributor|commit/);
    expect(joined).toMatch(/liquidit|venue|spread/);
    expect(joined).toMatch(/sentiment|communit|social/);
  });
});
