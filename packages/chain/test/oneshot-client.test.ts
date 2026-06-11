import { describe, it, expect, vi } from "vitest";
import { OneShotClient } from "../src/oneshot/client.js";

const ok = (result: unknown) =>
  ({ ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result }) }) as Response;

describe("OneShotClient", () => {
  it("getCapabilities returns per-chain target and fee collector", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ok({
        "84532": {
          targetAddress: "0xT",
          feeCollector: "0xF",
          tokens: [{ symbol: "USDC", address: "0xU" }],
        },
      }),
    );
    const c = new OneShotClient("https://relayer.example/relayers", fetchMock as never);
    const caps = await c.getCapabilities(84532);
    expect(caps.targetAddress).toBe("0xT");
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.method).toBe("relayer_getCapabilities");
  });

  it("throws a typed error on JSON-RPC error responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, error: { code: 4204, message: "Quote Expired" } }),
    } as Response);
    const c = new OneShotClient("https://relayer.example/relayers", fetchMock as never);
    await expect(c.getStatus("0xabc")).rejects.toMatchObject({ code: 4204 });
  });

  // Live API note: getFeeData.minFee is a DECIMAL string ("0.01") but
  // estimate.requiredPaymentAmount is BASE units ("10000"). parseFee exists
  // for APIs/networks that deviate; default BigInt matches live behavior.
  it("estimateThenSend supports a custom parseFee for decimal fee strings", async () => {
    const responses = [
      ok({ success: true, requiredPaymentAmount: "0.02", gasUsed: "1", context: "ctxA" }),
      ok({ success: true, requiredPaymentAmount: "0.02", gasUsed: "1", context: "ctxB" }),
      ok("0x" + "cd".repeat(32)),
    ];
    const fetchMock = vi.fn().mockImplementation(async () => responses.shift());
    const c = new OneShotClient("https://relayer.example/relayers", fetchMock as never);
    const parseFee = (s: string) => BigInt(Math.round(Number(s) * 1e6)); // USDC 6 decimals
    const rebuilds: bigint[] = [];
    await c.estimateThenSend(
      async (fee) => {
        rebuilds.push(fee);
        return { chainId: "84532", transactions: [] };
      },
      10000n, // 0.01 USDC in base units
      { parseFee },
    );
    expect(rebuilds).toEqual([10000n, 20000n]);
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
      { destinationUrl: "https://hook.example" },
    );
    expect(rebuilds).toEqual([10000n, 20000n]);
    expect(taskId).toMatch(/^0x[0-9a-f]{64}$/);
    const sendBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(sendBody.method).toBe("relayer_send7710Transaction");
    expect(sendBody.params.context).toBe("ctx2");
    expect(sendBody.params.destinationUrl).toBe("https://hook.example");
  });
});
