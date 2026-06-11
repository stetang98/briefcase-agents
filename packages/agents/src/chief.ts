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
  specialistDeps: (name: string, signedSlice: Delegation) => Omit<SpecialistDeps, "onPayment">;
  tokenAddress: Hex;
  totalBudget: bigint;
  /** Validity window for each slice delegation (security: never unbounded). */
  sliceExpirySeconds: number;
  /** When the chief redelegates a user's 7715 grant instead of its own authority. */
  parentPermissionContext?: Hex;
  emit: (e: BriefcaseEvent) => void;
  /** Optional payroll settlement (1Shot) executed after the report compiles. */
  settle?: () => Promise<void>;
}

/** Orchestrate one research job: slice budget → redelegate → run team → compile → settle. */
export async function runJob(
  jobId: string,
  topic: string,
  d: ChiefDeps,
): Promise<CompiledReport> {
  d.emit({ kind: "job.started", jobId, topic });

  const totalWeight = SPECIALISTS.reduce((sum, s) => sum + s.weight, 0);
  const unit = d.totalBudget / BigInt(totalWeight);
  const slices = planSlices(
    d.totalBudget,
    SPECIALISTS.map((s) => ({ name: s.name, amount: unit * BigInt(s.weight) })),
  );

  const sections: ReportSection[] = [];
  for (const spec of SPECIALISTS) {
    const slice = slices.find((s) => s.name === spec.name);
    if (!slice) continue;

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
      const allTools = buildSpecialistTools({
        ...deps,
        onPayment: (p) => d.emit({ kind: "payment.made", jobId, agent: spec.name, ...p }),
      });
      const tools = Object.fromEntries(
        Object.entries(allTools).filter(([name]) => spec.toolNames.includes(name)),
      );
      const result = await runAgentLoop({
        venice: d.venice,
        model: d.model,
        system: spec.system,
        task: `Research topic: ${topic}`,
        tools,
        onEvent: (e) =>
          d.emit({ kind: "agent.tool", jobId, agent: spec.name, detail: e.detail }),
      });
      sections.push({ agent: spec.name, text: result.text, failed: result.failed });
      d.emit({ kind: result.failed ? "agent.failed" : "agent.finished", jobId, agent: spec.name });
    } catch (err) {
      sections.push({
        agent: spec.name,
        text: "",
        failed: true,
        note: err instanceof Error ? err.message : "specialist crashed",
      });
      d.emit({ kind: "agent.failed", jobId, agent: spec.name });
    }
  }

  const report = compileReport(topic, sections);

  if (d.settle) {
    try {
      await d.settle();
    } catch {
      d.emit({ kind: "settlement.update", jobId, taskId: "", status: 400 });
    }
  }

  d.emit({ kind: "report.ready", jobId });
  return report;
}
