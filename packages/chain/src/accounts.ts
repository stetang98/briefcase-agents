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

/** Stateless 7702 smart account view over an EOA (Chief settlement wallet for 1Shot). */
export async function makeChief7702Account(pk: Hex, chain: Chain) {
  const account = privateKeyToAccount(pk);
  return toMetaMaskSmartAccount({
    client: publicClientFor(chain),
    implementation: Implementation.Stateless7702,
    address: account.address,
    signer: { account },
  });
}

export type BriefcaseSmartAccount = Awaited<ReturnType<typeof makeBuyerSmartAccount>>;
