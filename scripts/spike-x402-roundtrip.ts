// LIVE SPIKE: buyer smart account pays our local intel API through the
// MetaMask tx-sentinel facilitator on Base Sepolia (x402 + ERC-7710).
// Prereq: server running -> SERVER_PAYTO=<chief addr> pnpm --filter @briefcase/server dev
import "dotenv/config";
import type { Hex } from "viem";
import { make7702SmartAccount } from "../packages/chain/src/accounts.js";
import { makePaidFetch } from "../packages/chain/src/paidFetch.js";
import { CHAINS, requireEnv } from "../packages/chain/src/config.js";

// Facilitator requires the delegator to be a 7702-upgraded EOA (verified live).
const account = await make7702SmartAccount(requireEnv("DEV_BUYER_PK") as Hex, CHAINS.demo);
console.log("buyer 7702 smart account:", account.address);

const paidFetch = makePaidFetch({ account });
const url = process.env.INTEL_URL ?? "http://localhost:4021/api/intel/uniswap";
console.log("requesting:", url);

const res = await paidFetch(url);
console.log("status:", res.status);
console.log("payment-response:", res.headers.get("PAYMENT-RESPONSE"));
console.log("body:", JSON.stringify(await res.json(), null, 2));
