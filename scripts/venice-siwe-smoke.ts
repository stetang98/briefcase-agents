// Live smoke: authenticate to Venice with the Agent wallet (SIWE / EIP-4361
// over eip191) and run a real chat completion against the $5 x402 balance.
// The SIWE challenge is served by the balance endpoint; the signed header is
// then reused as a bearer-style credential on inference endpoints.
import "dotenv/config";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { requireEnv } from "../packages/chain/src/config.js";

const BASE = "https://api.venice.ai/api/v1";
const account = privateKeyToAccount(requireEnv("DEV_BUYER_PK") as Hex);

interface SiwxInfo {
  domain: string;
  uri: string;
  version: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
  statement: string;
}

/** Get a SIWE challenge (the balance endpoint serves one on unauthenticated hits). */
async function getChallenge(): Promise<SiwxInfo> {
  const res = await fetch(`${BASE}/x402/balance/${account.address}`);
  if (res.status !== 402) throw new Error(`expected 402 challenge, got ${res.status}`);
  const body = (await res.json()) as {
    extensions?: { "sign-in-with-x"?: { info: SiwxInfo } };
  };
  const info = body.extensions?.["sign-in-with-x"]?.info;
  if (!info) throw new Error("no sign-in-with-x challenge in response");
  return info;
}

/** Sign the EIP-4361 message (hand-rolled: Venice nonces contain '-', which viem rejects). */
async function buildAuthHeader(info: SiwxInfo): Promise<string> {
  const message =
    `${info.domain} wants you to sign in with your Ethereum account:\n` +
    `${account.address}\n\n` +
    `${info.statement}\n\n` +
    `URI: ${info.uri}\n` +
    `Version: ${info.version}\n` +
    `Chain ID: 8453\n` +
    `Nonce: ${info.nonce}\n` +
    `Issued At: ${info.issuedAt}\n` +
    `Expiration Time: ${info.expirationTime}`;
  const signature = await account.signMessage({ message });
  return Buffer.from(
    JSON.stringify({
      address: account.address,
      message,
      signature,
      timestamp: Date.now(),
      chainId: 8453,
    }),
  ).toString("base64");
}

/** Self-generated challenge: fresh nonce per request (server nonces are single-use). */
function freshChallenge(uri: string): SiwxInfo {
  const now = new Date();
  return {
    domain: "api.venice.ai",
    uri,
    version: "1",
    nonce: crypto.randomUUID().replace(/-/g, "").slice(0, 17),
    issuedAt: now.toISOString(),
    expirationTime: new Date(now.getTime() + 5 * 60_000).toISOString(),
    statement: "Sign in to Venice AI",
  };
}

void getChallenge; // server-issued variant kept for reference
const auth = await buildAuthHeader(freshChallenge(`${BASE}/x402/balance/${account.address}`));
console.log("SIWE header built for", account.address);

// 1. Balance (authenticated)
const bal = await fetch(`${BASE}/x402/balance/${account.address}`, {
  headers: { "X-Sign-In-With-X": auth },
});
console.log("balance status:", bal.status);
console.log(await bal.text());

// 2. Real chat completion (cheap model, tiny prompt), same credential
const chatAuth = await buildAuthHeader(freshChallenge(`${BASE}/chat/completions`));
const chat = await fetch(`${BASE}/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Sign-In-With-X": chatAuth },
  body: JSON.stringify({
    model: "venice-uncensored-1-2",
    messages: [{ role: "user", content: "Reply with exactly: BRIEFCASE ONLINE" }],
    max_tokens: 20,
  }),
});
console.log("chat status:", chat.status);
const j = (await chat.json()) as { choices?: { message?: { content?: string } }[] };
console.log("reply:", j.choices?.[0]?.message?.content ?? JSON.stringify(j).slice(0, 300));
console.log("balance remaining:", chat.headers.get("X-Balance-Remaining"));
