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

  it("buy_intel throws on payment failure so the loop reports it to the model", async () => {
    const paidFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 402 }));
    const tools = buildSpecialistTools(makeDeps({ paidFetch }));
    await expect(tools.buy_intel.run({ topic: "uni" })).rejects.toThrow(/402/);
  });

  it("read_chain delegates to publicRpc", async () => {
    const publicRpc = vi.fn().mockResolvedValue("0x2a");
    const tools = buildSpecialistTools(makeDeps({ publicRpc }));
    const out = await tools.read_chain.run({ method: "eth_blockNumber", params: [] });
    expect(out).toBe("0x2a");
    expect(publicRpc).toHaveBeenCalledWith("eth_blockNumber", []);
  });

  it("read_chain rejects non-allowlisted methods", async () => {
    const tools = buildSpecialistTools(makeDeps());
    await expect(
      tools.read_chain.run({ method: "eth_sendRawTransaction", params: [] }),
    ).rejects.toThrow(/not allowed/);
  });

  it("generate_image returns the image payload", async () => {
    const tools = buildSpecialistTools(makeDeps());
    const out = (await tools.generate_image.run({ prompt: "cover" })) as { image: string };
    expect(out.image).toBe("img-b64");
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
});
