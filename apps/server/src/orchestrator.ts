import { parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
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
  const buyerPk = process.env.DEV_BUYER_PK as Hex | undefined;
  const intelBaseUrl = process.env.INTEL_BASE_URL ?? "http://localhost:4021";
  if (!chiefPk || (!veniceKey && !buyerPk)) {
    console.warn("orchestrator disabled: DEV_CHIEF_PK plus VENICE_API_KEY or DEV_BUYER_PK required");
    return null;
  }

  const chain = CHAINS.demo;
  const publicClient = publicClientFor(chain);
  // Prefer wallet auth: the agent pays Venice from its own x402 balance.
  const venice = veniceKey
    ? new VeniceClient({ apiKey: veniceKey })
    : new VeniceClient({ walletAccount: privateKeyToAccount(buyerPk as Hex) });
  // Must support function calling or the agents only TALK about using tools.
  // zai-org-glm-4.7-flash is the cheap flash variant of Venice's
  // function_calling_default; venice-uncensored-1-2 does NOT do tool calls.
  const model = process.env.VENICE_MODEL ?? "zai-org-glm-4.7-flash";

  // Defense-in-depth: even server-side RPC stays read-only (no broadcast).
  const READONLY_RPC = new Set([
    "eth_blockNumber",
    "eth_getBalance",
    "eth_call",
    "eth_getCode",
    "eth_getTransactionCount",
    "eth_gasPrice",
    "eth_getLogs",
  ]);

  return async (jobId, topic, emit, signal) => {
    const chiefAccount: BriefcaseSmartAccount = await make7702SmartAccount(chiefPk, chain);

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
        publicRpc: (method, params) => {
          if (!READONLY_RPC.has(method)) {
            return Promise.reject(new Error(`rpc method not allowed: ${method}`));
          }
          return publicClient.request({ method, params } as never) as Promise<unknown>;
        },
      }),
      tokenAddress: ADDRESSES.usdcBaseSepolia,
      // µUSDC (6 decimals). Default 0.06 USDC = 60,000 µUSDC, split 3:2:1 across the team.
      totalBudget: parseUnits(process.env.JOB_BUDGET_USDC ?? "0.06", 6),
      sliceExpirySeconds: 600,
      emit: emit as (e: BriefcaseEvent) => void,
      signal,
    };

    return runJob(jobId, topic, deps);
  };
}
