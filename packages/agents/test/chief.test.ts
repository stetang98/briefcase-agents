import { describe, it, expect, vi } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { parseUnits } from "viem";
import { makeBuyerSmartAccount, CHAINS, ADDRESSES } from "@briefcase/chain";
import { runJob, type ChiefDeps } from "../src/chief.js";
import { SPECIALISTS } from "../src/specialists.js";
import type { VeniceMessage } from "../src/venice.js";

const finalMsg = (text: string): VeniceMessage => ({ role: "assistant", content: text });

async function makeDeps(overrides: Partial<ChiefDeps> = {}): Promise<ChiefDeps> {
  const chief = await makeBuyerSmartAccount(generatePrivateKey(), CHAINS.demo);
  const specialistAccounts = Object.fromEntries(
    await Promise.all(
      SPECIALISTS.map(async (s) => [
        s.name,
        await makeBuyerSmartAccount(generatePrivateKey(), CHAINS.demo),
      ]),
    ),
  );
  return {
    venice: { chat: vi.fn().mockResolvedValue(finalMsg("section text")) } as never,
    model: "test-model",
    chiefAccount: Object.assign(chief, {
      signDelegation: vi.fn().mockResolvedValue("0x" + "ab".repeat(65)),
    }) as never,
    specialistAddress: (name: string) =>
      (specialistAccounts as Record<string, { address: `0x${string}` }>)[name].address,
    specialistDeps: () => ({
      paidFetch: vi.fn() as unknown as typeof fetch,
      intelBaseUrl: "http://intel.local",
      venice: { generateImage: vi.fn().mockResolvedValue("img") } as never,
      publicRpc: vi.fn().mockResolvedValue("0x1"),
    }),
    tokenAddress: ADDRESSES.usdcBaseSepolia,
    totalBudget: parseUnits("6", 6),
    sliceExpirySeconds: 600,
    emit: vi.fn(),
    ...overrides,
  };
}

describe("runJob", () => {
  it("slices the budget by weight, signs a redelegation per specialist, runs all, compiles report", async () => {
    const deps = await makeDeps();
    const report = await runJob("job1", "uniswap", deps);

    const emitted = (deps.emit as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const slices = emitted.filter((e) => e.kind === "slice.created");
    expect(slices).toHaveLength(3);
    // weights 3/2/1 of 6 USDC -> 3, 2, 1 USDC
    expect(slices.map((s) => s.amount)).toEqual([
      parseUnits("3", 6).toString(),
      parseUnits("2", 6).toString(),
      parseUnits("1", 6).toString(),
    ]);
    // Scout & analyst sign real on-chain delegations; designer pays from the
    // Venice balance (empty delegationHash) and signs nothing.
    const signed = slices.filter((s) => s.delegationHash !== "");
    expect(signed).toHaveLength(2);
    for (const s of signed) expect(s.delegationHash).toMatch(/^0x[0-9a-f]{64}$/);

    expect(emitted.filter((e) => e.kind === "agent.finished")).toHaveLength(3);
    expect(emitted.at(-1)?.kind).toBe("report.ready");
    expect(report.markdown).toContain("Research Brief: uniswap");
    expect(deps.chiefAccount.signDelegation).toHaveBeenCalledTimes(2);
  });

  it("degrades gracefully: a failing specialist yields agent.failed + unavailable section", async () => {
    const deps = await makeDeps();
    let call = 0;
    (deps.venice.chat as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      call++;
      if (call === 1) throw new Error("venice down for scout");
      return finalMsg("ok");
    });
    const report = await runJob("job2", "uniswap", deps);
    const emitted = (deps.emit as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(emitted.filter((e) => e.kind === "agent.failed")).toHaveLength(1);
    expect(emitted.filter((e) => e.kind === "agent.finished")).toHaveLength(2);
    expect(report.markdown).toMatch(/unavailable/);
  });

  it("invokes settle after specialists and reports settlement failure as an event, not a crash", async () => {
    const deps = await makeDeps({
      settle: vi.fn().mockRejectedValue(new Error("relayer offline")),
    });
    const report = await runJob("job3", "uniswap", deps);
    expect(report.markdown).toBeTruthy();
    const emitted = (deps.emit as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(
      emitted.some((e) => e.kind === "settlement.update" && e.status === 400),
    ).toBe(true);
  });

  it("deterministically generates a cover image for the report (designer)", async () => {
    const deps = await makeDeps();
    const report = await runJob("jobimg", "uniswap", deps);
    // Designer calls venice.generateImage directly (not via the LLM), so the
    // cover is always present regardless of tool-calling behaviour.
    expect(report.coverImage).toBe("img");
    const emitted = (deps.emit as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(
      emitted.some((e) => e.kind === "agent.tool" && e.agent === "designer" && e.detail === "generate_image"),
    ).toBe(true);
    // Designer signs NO on-chain delegation (it pays from the Venice balance):
    // its slice.created carries an empty delegationHash, and the chief signs
    // exactly twice (scout + analyst).
    const designerSlice = emitted.find((e) => e.kind === "slice.created" && e.agent === "designer");
    expect(designerSlice?.delegationHash).toBe("");
    expect(deps.chiefAccount.signDelegation).toHaveBeenCalledTimes(2);
  });

  it("degrades when generateImage fails: designer agent.failed, report still ready", async () => {
    const deps = await makeDeps();
    const baseSpecialistDeps = deps.specialistDeps;
    deps.specialistDeps = (name, slice) =>
      name === "designer"
        ? {
            ...baseSpecialistDeps(name, slice),
            venice: { generateImage: vi.fn().mockRejectedValue(new Error("image api down")) } as never,
          }
        : baseSpecialistDeps(name, slice);
    const report = await runJob("jobfail", "uniswap", deps);
    expect(report.coverImage).toBeUndefined();
    const emitted = (deps.emit as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(emitted.some((e) => e.kind === "agent.failed" && e.agent === "designer")).toBe(true);
    expect(emitted.at(-1)?.kind).toBe("report.ready");
    expect(report.markdown).toMatch(/unavailable/);
  });

  it("rejects a totalBudget too small to slice", async () => {
    const deps = await makeDeps({ totalBudget: 2n });
    await expect(runJob("jobsmall", "uniswap", deps)).rejects.toThrow(/too small/);
  });

  it("kill switch: an aborted signal stops all specialist spending", async () => {
    const controller = new AbortController();
    controller.abort();
    const deps = await makeDeps({ signal: controller.signal });
    await runJob("jobkill", "uniswap", deps);
    // No specialist ran -> Venice was never called, every agent marked failed.
    expect((deps.venice.chat as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    const emitted = (deps.emit as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(emitted.filter((e) => e.kind === "agent.failed")).toHaveLength(3);
    expect(emitted.filter((e) => e.kind === "agent.finished")).toHaveLength(0);
  });
});
