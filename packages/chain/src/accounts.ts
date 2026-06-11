import { createPublicClient, http, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { toMetaMaskSmartAccount, Implementation } from "@metamask/smart-accounts-kit";

export function publicClientFor(chain: Chain) {
  return createPublicClient({ chain, transport: http() });
}

/** Counterfactual Hybrid smart account owned by a burner EOA (buyer/specialist wallets). */
export async function makeBuyerSmartAccount(pk: Hex, chain: Chain) {
  const account = privateKeyToAccount(pk);
  return toMetaMaskSmartAccount({
    client: publicClientFor(chain),
    implementation: Implementation.Hybrid,
    deployParams: [account.address, [], [], []],
    deploySalt: "0x",
    signer: { account },
  });
}

/**
 * Stateless 7702 smart account view over an EOA.
 * This is the canonical account type for ALL Briefcase wallets: the MetaMask
 * x402 facilitator requires delegator EOAs to be 7702-upgraded on-chain
 * (verified live: `invalid_exact_evm_erc7710_account_not_delegated`), and the
 * 1Shot relayer performs that upgrade gas-free via an attached authorization.
 */
export async function make7702SmartAccount(pk: Hex, chain: Chain) {
  const account = privateKeyToAccount(pk);
  return toMetaMaskSmartAccount({
    client: publicClientFor(chain),
    implementation: Implementation.Stateless7702,
    address: account.address,
    signer: { account },
  });
}

export type BriefcaseSmartAccount = Awaited<ReturnType<typeof makeBuyerSmartAccount>>;
