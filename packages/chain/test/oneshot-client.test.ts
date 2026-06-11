import { describe, it, expect, vi } from "vitest";
import { OneShotClient, OneShotRpcError } from "../src/oneshot/client.js";

const ok = (result: unknown) =>
  ({ ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result }) }) as Response;

const CAPS = {
  "84532": {
    targetAddress: "0xf1ef956eff4181Ce913b664713515996858B9Ca9",
    feeCollector: "0xE936e8FAf4A5655469182A49a505055B71C17604",
    tokens: [{ symbol: "USDC", address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" }],
  },
};

describe("OneShotClient", () => {
  it("getCapabilities returns per-chain target and fee collector (checksummed)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(CAPS));
    const c = new OneShotClient("https://relayer.example/relayers", fetchMock as never);
    const caps = await c.getCapabilities(84532);
    expect(caps.targetAddress).toBe("0xf1ef956eff4181Ce913b664713515996858B9Ca9");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.method).toBe("relayer_getCapabilities");
  });

  it("getCapabilities rejects malformed relayer addresses (injection guard)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ok({ "84532": { targetAddress: "not-an-address", feeCollector: "0xE936e8FAf4A5655469182A49a505055B71C17604", tokens: [] } }),
    );
    const c = new OneShotClient("https://relayer.example/relayers", fetchMock as never);
    await expect(c.getCapabilities(84532)).rejects.toThrow(/invalid.*address/i);
  });

  it("uses unique JSON-RPC ids per request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(CAPS));
    const c = new OneShotClient("https://relayer.example/relayers", fetchMock as never);
    await c.getCapabilities(84532);
    await c.getCapabilities(84532);
    const id1 = JSON.parse(fetchMock.mock.calls[0][1].body).id;
    const id2 = JSON.parse(fetchMock.mock.calls[1][1].body).id;
    expect(id1).not.toBe(id2);
  });

  it("throws a typed error on JSON-RPC error responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, error: { code: 4204, message: "Quote Expired" } }),
    } as Response);
    const c = new OneShotClient("https://relayer.example/relayers", fetchMock as never);
    await expect(c.getStatus("0xabc")).rejects.toMatchObject({ code: 4204 });
  });

  it("estimateThenSend re-estimates when fee changes, then sends with price-lock context", async () => {
    const responses = [
      ok({ success: true, requiredPaymentAmount: "20000", gasUsed: "1", context: "ctx1" }),
      ok({ success: true, requiredPaymentAmount: "20000", gasUsed: "1", context: "ctx2" }),
      ok("0x" + "ab".repeat(32)),
    ];
    const fetchMock = vi.fn().mockImplementation(async () => responses.shift());
    const c = new OneShotClient("https://relayer.example/relayers", fetchMock as never);
    const rebuilds: bigint[] = [];
    const taskId = await c.estimateThenSend(
      async (fee) => {
        rebuilds.push(fee);
        return { chainId: "84532", transactions: [] };
      },
      10000n,
      { maxFee: 50000n, destinationUrl: "https://hook.example" },
    );
    expect(rebuilds).toEqual([10000n, 20000n]);
    expect(taskId).toMatch(/^0x[0-9a-f]{64}$/);
    const sendBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(sendBody.method).toBe("relayer_send7710Transaction");
    expect(sendBody.params.context).toBe("ctx2");
    expect(sendBody.params.destinationUrl).toBe("https://hook.example");
    expect(sendBody.params.maxFee).toBeUndefined(); // internal option must not leak to the wire
  });

  it("SECURITY: refuses to re-sign above the maxFee ceiling (malicious relayer)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ok({ success: true, requiredPaymentAmount: "999999999", gasUsed: "1", context: "evil" }),
    );
    const c = new OneShotClient("https://relayer.example/relayers", fetchMock as never);
    await expect(
      c.estimateThenSend(async () => ({ chainId: "84532", transactions: [] }), 10000n, {
        maxFee: 50000n,
      }),
    ).rejects.toThrow(/exceeds.*ceiling/i);
    // buildSigned must never have been called with the inflated fee — only the initial one
  });

  it("SECURITY: aborts when the re-estimate diverges again (unstable fee)", async () => {
    const responses = [
      ok({ success: true, requiredPaymentAmount: "20000", gasUsed: "1", context: "ctx1" }),
      ok({ success: true, requiredPaymentAmount: "30000", gasUsed: "1", context: "ctx2" }),
    ];
    const fetchMock = vi.fn().mockImplementation(async () => responses.shift());
    const c = new OneShotClient("https://relayer.example/relayers", fetchMock as never);
    await expect(
      c.estimateThenSend(async () => ({ chainId: "84532", transactions: [] }), 10000n, {
        maxFee: 50000n,
      }),
    ).rejects.toThrow(/unstable/i);
  });

  it("throws 4211 when simulation reports failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ok({ success: false, requiredPaymentAmount: "10000", gasUsed: "0", context: "c" }),
    );
    const c = new OneShotClient("https://relayer.example/relayers", fetchMock as never);
    await expect(
      c.estimateThenSend(async () => ({ chainId: "84532", transactions: [] }), 10000n, {
        maxFee: 50000n,
      }),
    ).rejects.toMatchObject({ code: 4211 });
  });

  it("default parseFee handles both base-unit and decimal fee strings", async () => {
    const responses = [
      ok({ success: true, requiredPaymentAmount: "0.02", gasUsed: "1", context: "ctxA" }),
      ok({ success: true, requiredPaymentAmount: "0.02", gasUsed: "1", context: "ctxB" }),
      ok("0x" + "cd".repeat(32)),
    ];
    const fetchMock = vi.fn().mockImplementation(async () => responses.shift());
    const c = new OneShotClient("https://relayer.example/relayers", fetchMock as never);
    const rebuilds: bigint[] = [];
    await c.estimateThenSend(
      async (fee) => {
        rebuilds.push(fee);
        return { chainId: "84532", transactions: [] };
      },
      10000n, // 0.01 USDC base units
      { maxFee: 50000n, feeDecimals: 6 },
    );
    expect(rebuilds).toEqual([10000n, 20000n]); // "0.02" parsed via feeDecimals
  });

  it("rejects when capabilities entry for the chain is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({}));
    const c = new OneShotClient("https://relayer.example/relayers", fetchMock as never);
    await expect(c.getCapabilities(84532)).rejects.toThrow(/no capabilities/i);
  });

  expect(OneShotRpcError).toBeDefined();
});
