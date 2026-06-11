import { describe, it, expect } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { makeBuyerSmartAccount } from "../src/accounts.js";
import { CHAINS } from "../src/config.js";

describe("makeBuyerSmartAccount", () => {
  it("derives a deterministic smart-account address from a signer key", async () => {
    const pk = generatePrivateKey();
    const a = await makeBuyerSmartAccount(pk, CHAINS.demo);
    const b = await makeBuyerSmartAccount(pk, CHAINS.demo);
    expect(a.address).toBe(b.address);
    expect(a.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
