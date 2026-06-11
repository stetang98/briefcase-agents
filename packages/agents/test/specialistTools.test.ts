import { describe, it, expect, vi } from "vitest";
import { buildSpecialistTools } from "../src/specialistTools.js";
import { SPECIALISTS } from "../src/specialists.js";

function makeDeps(overrides: Partial<Parameters<typeof buildSpecialistTools>[0]> = {}) {
  return {
    paidFetch: vi.fn() as unknown as typeof fetch,
    intelBaseUrl: "http://intel.local",
    venice: { generateImage: vi.fn().mockResolvedValue("img-b64") } as never,
    publicRpc: vi.fn().mockResolvedValue("0x10"),
    ...overrides,
  };
}

describe("buildSpecialistTools", () => {
  it("exposes the three procurement tools", () => {
    const tools = buildSpecialistTools(makeDeps());
    expect(Object.keys(tools).sort()).toEqual(["buy_intel", "generate_image", "read_chain"]);
  });

  it("buy_intel pays via paidFetch and reports the payment receipt", async () => {
    const receipt = { success: true, amount: "10000", transaction: "0xabc" };
    const paidFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ topic: "uni", headlines: [] }), {
        status: 200,
        headers: {
          "PAYMENT-RESPONSE": Buffer.from(JSON.stringify(receipt)).toString("base64"),
        },
      }),
    );
    const onPayment = vi.fn();
    const tools = buildSpecialistTools(makeDeps({ paidFetch, onPayment }));
    const result = (await tools.buy_intel.run({ topic: "uni" })) as { topic: string };
    expect(result.topic).toBe("uni");
    expect(paidFetch).toHaveBeenCalledWith("http://intel.local/api/intel/uni");
    expect(onPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amount: "10000", tx: "0xabc" }),
    );
  });

  it("buy_intel retries transient payment failures and succeeds", async () => {
    const receipt = { success: true, amount: "10000", transaction: "0xabc" };
    const ok = () =>
      new Response(JSON.stringify({ topic: "uni", headlines: [] }), {
        status: 200,
        headers: {
          "PAYMENT-RESPONSE": Buffer.from(JSON.stringify(receipt)).toString("base64"),
        },
      });
    const paidFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 402 }))
      .mockResolvedValueOnce(ok());
    const onPayment = vi.fn();
    const tools = buildSpecialistTools(makeDeps({ paidFetch, onPayment, retryDelayMs: 0 }));
    const result = (await tools.buy_intel.run({ topic: "uni" })) as { topic: string };
    expect(result.topic).toBe("uni");
    expect(paidFetch).toHaveBeenCalledTimes(2);
    expect(onPayment).toHaveBeenCalledTimes(1);
    expect(onPayment).toHaveBeenCalledWith(expect.objectContaining({ tx: "0xabc" }));
  });

  it("buy_intel retries only once (bounds double-pay on settled-but-slow payments)", async () => {
    const paidFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 402 }));
    const onPayment = vi.fn();
    const tools = buildSpecialistTools(makeDeps({ paidFetch, onPayment, retryDelayMs: 0 }));
    await expect(tools.buy_intel.run({ topic: "uni" })).rejects.toThrow(/402/);
    expect(paidFetch).toHaveBeenCalledTimes(2);
    // No payment event for a failed purchase — audit trail must stay truthful.
    expect(onPayment).not.toHaveBeenCalled();
  });

  it("read_chain labels the network and decodes block numbers for the model", async () => {
    const publicRpc = vi.fn().mockResolvedValue("0x2a");
    const tools = buildSpecialistTools(makeDeps({ publicRpc }));
    const out = (await tools.read_chain.run({ method: "eth_blockNumber", params: [] })) as {
      network: string;
      result: unknown;
      decoded?: { blockNumber: number };
    };
    expect(out.network).toMatch(/Base Sepolia/i);
    expect(out.network).toMatch(/testnet/i);
    expect(out.result).toBe("0x2a");
    expect(out.decoded).toEqual({ blockNumber: 42 });
    expect(publicRpc).toHaveBeenCalledWith("eth_blockNumber", []);
  });

  it("read_chain decodes gas price into wei and gwei so the model cannot misconvert", async () => {
    // 600_896 wei = 0.000600896 gwei (sub-gwei testnet gas).
    const publicRpc = vi.fn().mockResolvedValue("0x92b40");
    const tools = buildSpecialistTools(makeDeps({ publicRpc }));
    const out = (await tools.read_chain.run({ method: "eth_gasPrice" })) as {
      decoded?: { wei: string; gwei: string };
    };
    expect(out.decoded).toEqual({ wei: "600896", gwei: "0.000600896" });
  });

  it("read_chain decodes balances into wei and eth", async () => {
    // 1.5 ETH
    const publicRpc = vi.fn().mockResolvedValue("0x14d1120d7b160000");
    const tools = buildSpecialistTools(makeDeps({ publicRpc }));
    const out = (await tools.read_chain.run({
      method: "eth_getBalance",
      params: ["0xabc", "latest"],
    })) as { decoded?: { wei: string; eth: string } };
    expect(out.decoded).toEqual({ wei: "1500000000000000000", eth: "1.5" });
  });

  it("read_chain unit formatting handles zero, exact wholes, and 1 wei", async () => {
    const cases: Array<[string, { wei: string; eth: string }]> = [
      ["0x0", { wei: "0", eth: "0" }],
      ["0xde0b6b3a7640000", { wei: "1000000000000000000", eth: "1" }],
      ["0x1", { wei: "1", eth: "0.000000000000000001" }],
    ];
    for (const [hex, expected] of cases) {
      const publicRpc = vi.fn().mockResolvedValue(hex);
      const tools = buildSpecialistTools(makeDeps({ publicRpc }));
      const out = (await tools.read_chain.run({
        method: "eth_getBalance",
        params: ["0xabc", "latest"],
      })) as { decoded?: { wei: string; eth: string } };
      expect(out.decoded).toEqual(expected);
    }
  });

  it("read_chain keeps counters lossless past Number.MAX_SAFE_INTEGER", async () => {
    // 2^60 — would silently lose precision through Number()
    const publicRpc = vi.fn().mockResolvedValue("0x1000000000000000");
    const tools = buildSpecialistTools(makeDeps({ publicRpc }));
    const out = (await tools.read_chain.run({ method: "eth_blockNumber" })) as {
      decoded?: { blockNumber: number | string };
    };
    expect(out.decoded).toEqual({ blockNumber: "1152921504606846976" });
  });

  it("read_chain passes through non-numeric results without a decoded field", async () => {
    const publicRpc = vi.fn().mockResolvedValue([{ topics: [] }]);
    const tools = buildSpecialistTools(makeDeps({ publicRpc }));
    const out = (await tools.read_chain.run({ method: "eth_getLogs", params: [{}] })) as {
      network: string;
      result: unknown;
      decoded?: unknown;
    };
    expect(out.network).toMatch(/testnet/i);
    expect(out.result).toEqual([{ topics: [] }]);
    expect(out.decoded).toBeUndefined();
  });

  it("read_chain rejects non-allowlisted methods", async () => {
    const tools = buildSpecialistTools(makeDeps());
    await expect(
      tools.read_chain.run({ method: "eth_sendRawTransaction", params: [] }),
    ).rejects.toThrow(/not allowed/);
  });

  it("generate_image surfaces the image via onImage and returns only a small confirmation", async () => {
    const onImage = vi.fn();
    const tools = buildSpecialistTools(makeDeps({ onImage }));
    const out = (await tools.generate_image.run({ prompt: "cover" })) as {
      ok: boolean;
      image?: string;
    };
    // The base64 must NOT be in the model-facing return (context-window safety).
    expect(out.image).toBeUndefined();
    expect(out.ok).toBe(true);
    expect(onImage).toHaveBeenCalledWith("img-b64");
  });
});

describe("SPECIALISTS", () => {
  it("defines scout, analyst, designer with positive weights and known tools", () => {
    expect(SPECIALISTS.map((s) => s.name)).toEqual(["scout", "analyst", "designer"]);
    for (const s of SPECIALISTS) {
      expect(s.weight).toBeGreaterThan(0);
      expect(s.system.length).toBeGreaterThan(20);
      for (const t of s.toolNames) {
        expect(["buy_intel", "read_chain", "generate_image"]).toContain(t);
      }
    }
  });

  it("caps each specialist's loop steps (latency/cost control)", () => {
    for (const s of SPECIALISTS) {
      expect(s.maxSteps).toBeGreaterThanOrEqual(2);
      expect(s.maxSteps).toBeLessThanOrEqual(5);
    }
  });
});
