// Venice x402 top-up: pay $5 USDC (Base mainnet) from the Agent wallet.
// SAFETY: re-discovers the payment requirements and refuses to sign unless
// every field matches the pinned expectations below.
import "dotenv/config";
import { privateKeyToAccount } from "viem/accounts";
import { createPaymentHeader } from "x402/client";
import type { Hex } from "viem";
import { requireEnv, ADDRESSES } from "../packages/chain/src/config.js";

const BASE = "https://api.venice.ai/api/v1";

// Pinned expectations (verified via discovery on 2026-06-12):
const EXPECT = {
  network: "eip155:8453",
  asset: ADDRESSES.usdcBase.toLowerCase(), // 0x833589fc…2913 native Base USDC
  amount: "5000000", // $5 — Venice minimum; do not pay more
  payTo: "0x2670b922ef37c7df47158725c0cc407b5382293f",
};

const account = privateKeyToAccount(requireEnv("DEV_BUYER_PK") as Hex);
console.log("paying from Agent wallet:", account.address);

// 1. Discover
const discover = await fetch(`${BASE}/x402/top-up`, { method: "POST" });
if (discover.status !== 402) throw new Error(`expected 402, got ${discover.status}`);
const { accepts } = (await discover.json()) as {
  accepts: { network: string; asset: string; amount: string; payTo: string; extra?: { name: string; version: string } }[];
};
const req = accepts.find((a) => a.network === EXPECT.network);
if (!req) throw new Error("no Base-mainnet option in accepts");

// 2. SAFETY GATE — refuse on any mismatch
const mismatches: string[] = [];
if (req.asset.toLowerCase() !== EXPECT.asset) mismatches.push(`asset ${req.asset}`);
if (req.amount !== EXPECT.amount) mismatches.push(`amount ${req.amount}`);
if (req.payTo.toLowerCase() !== EXPECT.payTo) mismatches.push(`payTo ${req.payTo}`);
if (mismatches.length > 0) {
  throw new Error(`ABORT — requirements changed since discovery: ${mismatches.join(", ")}`);
}
console.log("requirements verified: $5 native USDC on Base to", req.payTo);

// 3. Sign the EIP-3009 payment (authorizes EXACTLY this $5 transfer, nothing else)
const header = await createPaymentHeader(account, 2, {
  scheme: "exact",
  network: "base",
  maxAmountRequired: EXPECT.amount,
  resource: `${BASE}/x402/top-up`,
  description: "Venice x402 top-up",
  mimeType: "application/json",
  payTo: req.payTo,
  maxTimeoutSeconds: 300,
  asset: req.asset,
  extra: req.extra ?? { name: "USD Coin", version: "2" },
});
console.log("payment header signed (len", header.length, ")");

// 4. Settle
const settle = await fetch(`${BASE}/x402/top-up`, {
  method: "POST",
  headers: { "X-402-Payment": header },
});
const body = await settle.text();
console.log("settle status:", settle.status);
console.log(body.slice(0, 1000));
