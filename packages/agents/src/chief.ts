import type { Hex } from "viem";
import {
  planSlices,
  buildSliceDelegation,
  delegationId,
  type BriefcaseSmartAccount,
} from "@briefcase/chain";
import type { Delegation } from "@metamask/smart-accounts-kit";
import { runAgentLoop } from "./agentLoop.js";
import { buildSpecialistTools, type SpecialistDeps } from "./specialistTools.js";
import { readChainSnapshot, analystTask, analystFallbackText, isGrounded } from "./analyst.js";
import { SPECIALISTS } from "./specialists.js";
import { compileReport, type CompiledReport, type ReportSection } from "./report.js";
import type { VeniceClient } from "./venice.js";

export type BriefcaseEvent = Record<string, unknown> & { kind: string };

export interface ChiefDeps {
  venice: VeniceClient;
  model: string;
  /** Chief's smart account — signs the per-specialist redelegations. */
  chiefAccount: BriefcaseSmartAccount;
  /** Resolves the wallet address a specialist's slice is delegated to. */
  specialistAddress: (name: string) => Hex;
  /** Builds the procurement deps for one specialist (paidFetch carries its slice). */
  specialistDeps: (name: string, signedSlice?: Delegation) => Omit<SpecialistDeps, "onPayment">;
  tokenAddress: Hex;
  totalBudget: bigint;
  /** Validity window for each slice delegation (security: never unbounded). */
  sliceExpirySeconds: number;
  /** When the chief redelegates a user's 7715 grant instead of its own authority. */
  parentPermissionContext?: Hex;
  emit: (e: BriefcaseEvent) => void;
  /** Optional payroll settlement (1Shot) executed after the report compiles. */
  settle?: () => Promise<void>;
  /** Abort further spending mid-job (the kill switch). Checked before each specialist. */
  signal?: AbortSignal;
}

/** Orchestrate one research job: slice budget → redelegate → run team → compile → settle. */
export async function runJob(
  jobId: string,
  topic: string,
  d: ChiefDeps,
): Promise<CompiledReport> {
  d.emit({ kind: "job.started", jobId, topic });

  const totalWeight = SPECIALISTS.reduce((sum, s) => sum + s.weight, 0);
  if (d.totalBudget < BigInt(totalWeight)) {
    throw new Error(
      `totalBudget ${d.totalBudget} too small: need >= ${totalWeight} micro-units to slice`,
    );
  }
  const unit = d.totalBudget / BigInt(totalWeight);
  const slices = planSlices(
    d.totalBudget,
    SPECIALISTS.map((s) => ({ name: s.name, amount: unit * BigInt(s.weight) })),
  );

  const sections: ReportSection[] = [];
  for (const spec of SPECIALISTS) {
    const slice = slices.find((s) => s.name === spec.name);
    if (!slice) continue;

    // Kill switch: once revoked, do NO further signing or spending.
    if (d.signal?.aborted) {
      sections.push({ agent: spec.name, text: "", failed: true, note: "permission revoked" });
      d.emit({ kind: "agent.failed", jobId, agent: spec.name });
      continue;
    }

    // Designer is deterministic: it always produces exactly one cover and pays
    // from the Venice x402 balance, NOT an on-chain ERC-7710 delegation — so it
    // signs no slice. Handled before delegation signing so no unusable spend
    // capability is ever minted. Scout/Analyst remain true tool-calling agents.
    if (spec.name === "designer") {
      d.emit({
        kind: "slice.created",
        jobId,
        agent: spec.name,
        amount: slice.amount.toString(),
        delegationHash: "",
      });
      d.emit({ kind: "agent.started", jobId, agent: spec.name });
      d.emit({ kind: "agent.tool", jobId, agent: spec.name, detail: "generate_image" });
      try {
        const deps = d.specialistDeps(spec.name);
        const prompt =
          `Abstract editorial cover image for a crypto research brief on "${topic}". ` +
          `Minimal, sophisticated, dark navy and warm brass palette, no text.`;
        const coverImage = await deps.venice.generateImage(prompt, undefined, d.signal);
        sections.push({ agent: spec.name, text: `Cover: ${topic}`, image: coverImage });
        d.emit({ kind: "agent.finished", jobId, agent: spec.name });
      } catch {
        sections.push({ agent: spec.name, text: "", failed: true, note: "cover generation unavailable" });
        d.emit({ kind: "agent.failed", jobId, agent: spec.name });
      }
      continue;
    }

    const delegation = buildSliceDelegation({
      from: d.chiefAccount,
      toAddress: d.specialistAddress(spec.name),
      tokenAddress: d.tokenAddress,
      amount: slice.amount,
      salt: slice.salt,
      expirySeconds: d.sliceExpirySeconds,
      ...(d.parentPermissionContext
        ? { parentPermissionContext: d.parentPermissionContext }
        : {}),
    });
    const signature = await d.chiefAccount.signDelegation({ delegation });
    const signedSlice: Delegation = { ...delegation, signature };
    d.emit({
      kind: "slice.created",
      jobId,
      agent: spec.name,
      amount: slice.amount.toString(),
      delegationHash: delegationId(delegation),
    });

    d.emit({ kind: "agent.started", jobId, agent: spec.name });
    try {
      const deps = d.specialistDeps(spec.name, signedSlice);

      // Analyst is CODE-GROUNDED: the chief reads the chain itself (real RPC
      // reads, surfaced as the same narrative tool events), hands the decoded
      // numbers to the model, and verifies the prose actually quotes them —
      // otherwise a deterministic fallback ships. The flash-tier model proved
      // too unreliable at calling read_chain and quoting results on its own.
      // (The analyst's slice above is still signed on purpose: per-specialist
      // ERC-7710 redelegation is part of the demo evidence, and the slice is
      // expiry-bounded and never redeemed — read-only work spends nothing.)
      if (spec.name === "analyst") {
        const snapshot = await readChainSnapshot(
          deps.publicRpc,
          () => d.emit({ kind: "agent.tool", jobId, agent: spec.name, detail: "read_chain" }),
          d.signal,
        );
        const result = await runAgentLoop({
          venice: d.venice,
          model: d.model,
          system: spec.system,
          task: analystTask(topic, snapshot),
          tools: {},
          maxSteps: spec.maxSteps,
          signal: d.signal,
        });
        const grounded = !result.failed && isGrounded(result.text, snapshot);
        sections.push({
          agent: spec.name,
          text: grounded ? result.text : analystFallbackText(topic, snapshot),
        });
        d.emit({ kind: "agent.finished", jobId, agent: spec.name });
        continue;
      }

      const tools = buildSpecialistTools({
        ...deps,
        onPayment: (p) => d.emit({ kind: "payment.made", jobId, agent: spec.name, ...p }),
      });
      const scopedTools = Object.fromEntries(
        Object.entries(tools).filter(([name]) => spec.toolNames.includes(name)),
      );
      const result = await runAgentLoop({
        venice: d.venice,
        model: d.model,
        system: spec.system,
        task: `Research topic: ${topic}`,
        tools: scopedTools,
        maxSteps: spec.maxSteps,
        onEvent: (e) =>
          d.emit({ kind: "agent.tool", jobId, agent: spec.name, detail: e.detail }),
        // Kill switch reaches all the way down: aborts in-flight Venice calls,
        // retry backoff, and pre-tool execution (tools spend real funds).
        signal: d.signal,
      });
      sections.push({ agent: spec.name, text: result.text, failed: result.failed });
      d.emit({ kind: result.failed ? "agent.failed" : "agent.finished", jobId, agent: spec.name });
    } catch (err) {
      // Log full error server-side; keep account/balance details OUT of the
      // user-facing report (it is served over /api/jobs/:id).
      console.error(`[chief] ${spec.name} failed:`, err instanceof Error ? err.message : err);
      sections.push({ agent: spec.name, text: "", failed: true, note: "specialist unavailable" });
      d.emit({ kind: "agent.failed", jobId, agent: spec.name });
    }
  }

  const report = compileReport(topic, sections);

  if (d.settle) {
    try {
      await d.settle();
    } catch {
      d.emit({ kind: "settlement.update", jobId, status: 400 });
    }
  }

  d.emit({ kind: "report.ready", jobId });
  return report;
}
