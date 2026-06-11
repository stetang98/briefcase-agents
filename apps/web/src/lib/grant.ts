import { createWalletClient, custom, type WalletClient } from "viem";
import { erc7715ProviderActions } from "@metamask/smart-accounts-kit/actions";
import {
  DEMO_CHAIN_ID,
  USDC_SEPOLIA,
  SESSION_ACCOUNT,
  GRANT_PERIOD_AMOUNT,
  GRANT_PERIOD_SECONDS,
} from "./config.js";

export interface GrantedPermission {
  context: `0x${string}`;
  from: `0x${string}`;
  signerMeta?: unknown;
}

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

function getProvider(): Eip1193 {
  const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!eth) throw new Error("MetaMask not detected — install the MetaMask extension (>= 13.23).");
  return eth;
}

/** Connect the MetaMask extension and return the active account address. */
export async function connectWallet(): Promise<`0x${string}`> {
  const provider = getProvider();
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as `0x${string}`[];
  if (!accounts?.length) throw new Error("No account authorized in MetaMask.");
  return accounts[0];
}

/**
 * Request an ERC-7715 Advanced Permission from the MetaMask extension:
 * a periodic ERC-20 (USDC) allowance the agent can spend on the user's behalf.
 * This is the demo's opening shot — the MetaMask grant popup.
 */
export async function requestBudgetGrant(): Promise<GrantedPermission> {
  const provider = getProvider();
  const walletClient: WalletClient = createWalletClient({
    transport: custom(provider),
  }).extend(erc7715ProviderActions());

  const expiry = Math.floor(Date.now() / 1000) + 7 * GRANT_PERIOD_SECONDS;

  const granted = await (
    walletClient as unknown as {
      requestExecutionPermissions: (reqs: unknown[]) => Promise<
        { context: `0x${string}`; from: `0x${string}`; signerMeta?: unknown }[]
      >;
    }
  ).requestExecutionPermissions([
    {
      chainId: DEMO_CHAIN_ID,
      expiry,
      to: SESSION_ACCOUNT,
      permission: {
        type: "erc20-token-periodic",
        data: {
          tokenAddress: USDC_SEPOLIA,
          periodAmount: GRANT_PERIOD_AMOUNT,
          periodDuration: GRANT_PERIOD_SECONDS,
          justification: "Briefcase research desk: up to 10 USDC/day for autonomous research.",
        },
        isAdjustmentAllowed: true,
      },
    },
  ]);

  const first = granted[0];
  return { context: first.context, from: first.from, signerMeta: first.signerMeta };
}
