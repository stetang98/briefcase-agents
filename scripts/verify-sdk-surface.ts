// Fail fast if research-derived API names drifted from the installed packages.
import {
  toMetaMaskSmartAccount,
  createDelegation,
  Implementation,
  ScopeType,
} from "@metamask/smart-accounts-kit";
import {
  erc7715ProviderActions,
  erc7710WalletActions,
} from "@metamask/smart-accounts-kit/actions";
import { createx402DelegationProvider } from "@metamask/smart-accounts-kit/experimental";
import { x402Erc7710Client, x402ExactEvmErc7710ServerScheme } from "@metamask/x402";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";

const surface = {
  toMetaMaskSmartAccount,
  createDelegation,
  Implementation,
  ScopeType,
  erc7715ProviderActions,
  erc7710WalletActions,
  createx402DelegationProvider,
  x402Erc7710Client,
  x402ExactEvmErc7710ServerScheme,
  x402Client,
  x402HTTPClient,
  wrapFetchWithPayment,
};

const missing = Object.entries(surface).filter(([, v]) => v === undefined).map(([k]) => k);
if (missing.length > 0) {
  console.error("MISSING EXPORTS:", missing.join(", "));
  process.exit(1);
}
console.log("all SDK exports resolved: true");
