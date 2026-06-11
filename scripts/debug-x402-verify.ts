// Debug: manually run the buyer payment steps and ask the facilitator /verify
// directly so we can see WHY verification fails.
import "dotenv/config";
import type { Hex } from "viem";
import { createx402DelegationProvider } from "@metamask/smart-accounts-kit/experimental";
import { x402Erc7710Client } from "@metamask/x402";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { make7702SmartAccount } from "../packages/chain/src/accounts.js";
import { CHAINS, FACILITATOR_BASE_SEPOLIA, requireEnv } from "../packages/chain/src/config.js";

const account = await make7702SmartAccount(requireEnv("DEV_BUYER_PK") as Hex, CHAINS.demo);
console.log("buyer 7702 smart account:", account.address);

const provider = createx402DelegationProvider({ account });
const erc7710Client = new x402Erc7710Client({ delegationProvider: provider });
const core = new x402Client().register("eip155:*", erc7710Client);
const http = new x402HTTPClient(core);

// 1. Get the 402 challenge
const res = await fetch("http://localhost:4021/api/intel/uniswap");
console.log("challenge status:", res.status);
const body = await res.text();
const paymentRequired = http.getPaymentRequiredResponse(
  (name) => res.headers.get(name),
  body ? JSON.parse(body) : undefined,
);
console.log("paymentRequired:", JSON.stringify(paymentRequired, null, 2));

// 2. Create the payment payload
const payload = await core.createPaymentPayload(paymentRequired);
console.log("payload created. scheme:", payload.accepted?.scheme ?? "(?)");
console.log(JSON.stringify(payload, null, 2).slice(0, 1500));

// 3. Ask the facilitator to verify directly
const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_BASE_SEPOLIA });
const accepted = Array.isArray(paymentRequired.accepts)
  ? paymentRequired.accepts[0]
  : paymentRequired.accepts;
try {
  const verdict = await facilitator.verify(payload, accepted);
  console.log("facilitator verdict:", JSON.stringify(verdict, null, 2));
} catch (err) {
  console.error("facilitator verify threw:", err);
}
