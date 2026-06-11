import { describe, it, expect } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { parseUnits } from "viem";
import { makeBuyerSmartAccount } from "../src/accounts.js";
import { planSlices, buildSliceDelegation } from "../src/slicing.js";
import { CHAINS, ADDRESSES } from "../src/config.js";

describe("planSlices", () => {
  it("rejects an empty slice list", () => {
    expect(() => planSlices(parseUnits("10", 6), [])).toThrow(/non-empty/);
  });

  it("rejects zero or negative slice amounts", () => {
    expect(() => planSlices(parseUnits("10", 6), [{ name: "scout", amount: 0n }])).toThrow(
      /non-positive/,
    );
    expect(() => planSlices(parseUnits("10", 6), [{ name: "scout", amount: -5n }])).toThrow(
      /non-positive/,
    );
  });

  it("rejects slices that sum over the parent budget", () => {
    expect(() =>
      planSlices(parseUnits("10", 6), [
        { name: "scout", amount: parseUnits("6", 6) },
        { name: "analyst", amount: parseUnits("5", 6) },
      ]),
    ).toThrow(/exceeds parent budget/);
  });

  it("accepts slices within budget and assigns unique salts", () => {
    const plan = planSlices(parseUnits("10", 6), [
      { name: "scout", amount: parseUnits("3", 6) },
      { name: "analyst", amount: parseUnits("2", 6) },
    ]);
    expect(plan).toHaveLength(2);
    expect(new Set(plan.map((p) => p.salt)).size).toBe(2);
    plan.forEach((p) => expect(p.salt).toMatch(/^0x[0-9a-f]{64}$/));
  });
});

describe("buildSliceDelegation", () => {
  it("builds an unsigned delegation from chief to a specialist with ERC20 cap", async () => {
    const chief = await makeBuyerSmartAccount(generatePrivateKey(), CHAINS.demo);
    const scout = await makeBuyerSmartAccount(generatePrivateKey(), CHAINS.demo);
    const d = buildSliceDelegation({
      from: chief,
      toAddress: scout.address,
      tokenAddress: ADDRESSES.usdcBaseSepolia,
      amount: parseUnits("3", 6),
      salt: ("0x" + "11".repeat(32)) as `0x${string}`,
    });
    expect(d.delegator.toLowerCase()).toBe(chief.address.toLowerCase());
    expect(d.delegate.toLowerCase()).toBe(scout.address.toLowerCase());
    expect(d.caveats.length).toBeGreaterThan(0);
    expect(d.signature === undefined || d.signature === "0x").toBe(true);
  });

  it("adds a timestamp caveat when expirySeconds is set", async () => {
    const chief = await makeBuyerSmartAccount(generatePrivateKey(), CHAINS.demo);
    const scout = await makeBuyerSmartAccount(generatePrivateKey(), CHAINS.demo);
    const noExpiry = buildSliceDelegation({
      from: chief,
      toAddress: scout.address,
      tokenAddress: ADDRESSES.usdcBaseSepolia,
      amount: parseUnits("3", 6),
      salt: ("0x" + "11".repeat(32)) as `0x${string}`,
    });
    const withExpiry = buildSliceDelegation({
      from: chief,
      toAddress: scout.address,
      tokenAddress: ADDRESSES.usdcBaseSepolia,
      amount: parseUnits("3", 6),
      salt: ("0x" + "11".repeat(32)) as `0x${string}`,
      expirySeconds: 300,
    });
    expect(withExpiry.caveats.length).toBe(noExpiry.caveats.length + 1);
  });

  it("rejects providing both parent sources", async () => {
    const chief = await makeBuyerSmartAccount(generatePrivateKey(), CHAINS.demo);
    expect(() =>
      buildSliceDelegation({
        from: chief,
        toAddress: chief.address,
        tokenAddress: ADDRESSES.usdcBaseSepolia,
        amount: 1n,
        salt: ("0x" + "11".repeat(32)) as `0x${string}`,
        parentDelegation: "0xdead",
        parentPermissionContext: "0xbeef",
      }),
    ).toThrow(/mutually exclusive/);
  });
});
