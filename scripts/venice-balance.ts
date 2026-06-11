// Check the Agent wallet's Venice x402 balance (SIWE-authenticated, free).
import "dotenv/config";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { requireEnv } from "../packages/chain/src/config.js";

const account = privateKeyToAccount(requireEnv("DEV_BUYER_PK") as Hex);
const uri = `https://api.venice.ai/api/v1/x402/balance/${account.address}`;
const now = new Date();
const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 17);
const message =
  `api.venice.ai wants you to sign in with your Ethereum account:\n${account.address}\n\n` +
  `Sign in to Venice AI\n\nURI: ${uri}\nVersion: 1\nChain ID: 8453\nNonce: ${nonce}\n` +
  `Issued At: ${now.toISOString()}\n` +
  `Expiration Time: ${new Date(now.getTime() + 300_000).toISOString()}`;
const signature = await account.signMessage({ message });
const header = Buffer.from(
  JSON.stringify({ address: account.address, message, signature, timestamp: Date.now(), chainId: 8453 }),
).toString("base64");
const res = await fetch(uri, { headers: { "X-Sign-In-With-X": header } });
console.log(await res.text());
