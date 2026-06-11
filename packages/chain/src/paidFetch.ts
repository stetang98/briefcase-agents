import type { Hex } from "viem";
import { createx402DelegationProvider } from "@metamask/smart-accounts-kit/experimental";
import { x402Erc7710Client } from "@metamask/x402";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import type { BriefcaseSmartAccount } from "./accounts.js";

/**
 * Discriminated union: when spending a user's 7715 grant, `from` (the user's
 * account from the grant) is REQUIRED alongside `parentPermissionContext`.
 */
export type PaidFetchOptions =
  | {
      /** The paying smart account spending its own funds. */
      account: BriefcaseSmartAccount;
      parentPermissionContext?: never;
      from?: never;
      fetchImpl?: typeof fetch;
    }
  | {
      /** Session account redelegating a user's 7715 grant. */
      account: BriefcaseSmartAccount;
      parentPermissionContext: Hex;
      from: Hex;
      fetchImpl?: typeof fetch;
    };

/** HTTP client that auto-pays x402 challenges with an ERC-7710 delegation. */
export function makePaidFetch(opts: PaidFetchOptions): typeof fetch {
  const delegationProvider = createx402DelegationProvider({
    account: opts.account,
    ...(opts.parentPermissionContext
      ? { parentPermissionContext: opts.parentPermissionContext, from: opts.from }
      : {}),
  });
  const erc7710Client = new x402Erc7710Client({ delegationProvider });
  const core = new x402Client().register("eip155:*", erc7710Client);
  return wrapFetchWithPayment(opts.fetchImpl ?? fetch, new x402HTTPClient(core));
}
