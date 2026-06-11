/** Demo runs the 7715 grant on Base Sepolia (free); session account = chief agent. */
export const DEMO_CHAIN_ID = 84532;

/** USDC on Base Sepolia (the token the user grants a periodic allowance of). */
export const USDC_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;

/** The agent session account the user delegates to (chief). Override via env. */
export const SESSION_ACCOUNT =
  (import.meta.env.VITE_SESSION_ACCOUNT as `0x${string}` | undefined) ??
  "0x39ba9943aDBcDB3a8C9C06e25ddABd134A64F793";

/** Default budget the user grants: 10 USDC per day. */
export const GRANT_PERIOD_AMOUNT = 10_000_000n; // 10 USDC (6 decimals)
export const GRANT_PERIOD_SECONDS = 86_400; // 1 day
