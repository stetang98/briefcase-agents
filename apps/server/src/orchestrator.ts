import { parseUnits, type Hex } from "viem";
import {
  make7702SmartAccount,
  publicClientFor,
  CHAINS,
  ADDRESSES,
  makePaidFetch,
  type BriefcaseSmartAccount,
} from "@briefcase/chain";
import {
  runJob,
  VeniceClient,
  type BriefcaseEvent,
  type ChiefDeps,
} from "@briefcase/agents";
import type { RunJobFn } from "./jobs.js";

/**
 * Wire the real agent orchestrator from environment config. Returns a RunJobFn
 * the server can hand to the jobs router, or null if required env is missing.
 */
export function buildOrchestrator(): RunJobFn | null {
  const chiefPk = process.env.DEV_CHIEF_PK as Hex | undefined;
  const veniceKey = process.env.VENICE_API_KEY;
  const intelBaseUrl = process.env.INTEL_BASE_URL ?? "http://localhost:4021";
  if (!chiefPk || !veniceKey) {
    console.warn("orchestrator disabled: DEV_CHIEF_PK and VENICE_API_KEY required");
    return null;
  }

  const chain = CHAINS.demo;
  const publicClient = publicClientFor(chain);
  const venice = new VeniceClient({ apiKey: veniceKey });
  const model = process.env.VENICE_MODEL ?? "venice-uncensored-1-2";

  return async (jobId, topic, emit) => {
    // 7702 and Hybrid accounts share the address/environment/signDelegation
    // surface the chief needs; cast to the common shape used by the agents pkg.
    const chiefAccount = (await make7702SmartAccount(
      chiefPk,
      chain,
    )) as unknown as BriefcaseSmartAccount;

    const deps: ChiefDeps = {
      venice,
      model,
      chiefAccount,
      // For the demo all specialist slices redeem against the chief itself; the
      // chain layer enforces the per-slice ERC20 cap regardless of recipient.
      specialistAddress: () => chiefAccount.address,
      specialistDeps: () => ({
        paidFetch: makePaidFetch({ account: chiefAccount }),
        intelBaseUrl,
        venice,
        publicRpc: (method, params) =>
          publicClient.request({ method, params } as never) as Promise<unknown>,
      }),
      tokenAddress: ADDRESSES.usdcBaseSepolia,
      totalBudget: parseUnits(process.env.JOB_BUDGET_USDC ?? "0.06", 6),
      sliceExpirySeconds: 600,
      emit: emit as (e: BriefcaseEvent) => void,
    };

    return runJob(jobId, topic, deps);
  };
}
