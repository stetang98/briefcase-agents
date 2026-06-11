import { baseSepolia, base } from "viem/chains";

export const CHAINS = { demo: baseSepolia, settlement: base } as const;

export const ADDRESSES = {
  usdcBaseSepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  usdcBase: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
} as const;

export const FACILITATOR_BASE_SEPOLIA =
  "https://tx-sentinel-base-sepolia.api.cx.metamask.io/platform/v2/x402";
export const ONESHOT_TESTNET = "https://relayer.1shotapi.dev/relayers";
export const ONESHOT_MAINNET = "https://relayer.1shotapi.com/relayers";

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
