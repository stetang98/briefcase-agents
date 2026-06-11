import { describe, it, expect } from "vitest";
import { compileReport } from "../src/report.js";

describe("compileReport", () => {
  it("merges sections into markdown with topic heading", () => {
    const r = compileReport("uniswap", [
      { agent: "scout", text: "- finding one" },
      { agent: "analyst", text: "block 42, balance 7 USDC" },
      { agent: "designer", text: "Abstract liquidity flows", image: "b64img" },
    ]);
    expect(r.markdown).toContain("# Research Brief: uniswap");
    expect(r.markdown).toContain("- finding one");
    expect(r.markdown).toContain("block 42");
    expect(r.coverImage).toBe("b64img");
    expect(r.sections).toHaveLength(3);
  });

  it("renders failed sections as explicit unavailable notes, never empty", () => {
    const r = compileReport("uniswap", [
      { agent: "scout", text: "", failed: true, note: "payment declined" },
      { agent: "analyst", text: "data ok" },
    ]);
    expect(r.markdown).toMatch(/scout.*unavailable/i);
    expect(r.markdown).toContain("payment declined");
    expect(r.markdown).toContain("data ok");
  });
});
