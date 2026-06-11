import { describe, it, expect } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { makeBuyerSmartAccount } from "../src/accounts.js";
import { makePaidFetch } from "../src/paidFetch.js";
import { CHAINS } from "../src/config.js";

describe("makePaidFetch", () => {
  it("returns a fetch-compatible function and passes through non-402 responses", async () => {
    const account = await makeBuyerSmartAccount(generatePrivateKey(), CHAINS.demo);
    const inner = (async () =>
      new Response(JSON.stringify({ free: true }), { status: 200 })) as typeof fetch;
    const paidFetch = makePaidFetch({ account, fetchImpl: inner });
    const res = await paidFetch("https://example.com/free");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ free: true });
  });
});
