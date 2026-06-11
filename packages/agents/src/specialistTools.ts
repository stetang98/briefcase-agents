import type { VeniceClient } from "./venice.js";
import type { ToolMap } from "./tools.js";

export interface PaymentInfo {
  url: string;
  amount?: string;
  tx?: string;
}

export interface SpecialistDeps {
  /** x402-wrapped fetch carrying this specialist's delegation slice. */
  paidFetch: typeof fetch;
  intelBaseUrl: string;
  venice: VeniceClient;
  /** Read-only chain access (viem publicClient.request or Venice crypto RPC). */
  publicRpc: (method: string, params: unknown[]) => Promise<unknown>;
  onPayment?: (info: PaymentInfo) => void;
  /** Side channel for the generated cover image (kept OUT of the model context). */
  onImage?: (base64: string) => void;
  /** Backoff between buy_intel retry attempts (tests pass 0). */
  retryDelayMs?: number;
}

/** Read-only allowlist — agents must never broadcast via this tool. */
const ALLOWED_RPC = new Set([
  "eth_blockNumber",
  "eth_getBalance",
  "eth_call",
  "eth_getCode",
  "eth_getTransactionCount",
  "eth_gasPrice",
  "eth_getLogs",
]);

/**
 * Facilitator settlement is occasionally flaky — retry ONCE on failure.
 * Capped at 2 because each paidFetch attempt is a full x402 challenge/pay
 * cycle: a 402 after a settled-but-slow payment means a retry pays again,
 * so the attempt cap bounds the worst-case overpayment to one slice price.
 */
const BUY_INTEL_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 1500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Format a bigint with `decimals` fractional digits, trailing zeros trimmed. */
function formatUnits(value: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Lossless number for JSON: stays a string past Number.MAX_SAFE_INTEGER. */
function toSafeNumber(value: bigint): number | string {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
}

/**
 * Decode numeric hex results in code so the model never misreads hex or
 * misconverts units (a raw wei value once got reported as "600,896 Gwei").
 */
export function decodeRpcResult(
  method: string,
  result: unknown,
): Record<string, unknown> | undefined {
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]+$/.test(result)) return undefined;
  const value = BigInt(result);
  switch (method) {
    case "eth_blockNumber":
      return { blockNumber: toSafeNumber(value) };
    case "eth_getTransactionCount":
      return { transactionCount: toSafeNumber(value) };
    case "eth_gasPrice":
      return { wei: value.toString(), gwei: formatUnits(value, 9) };
    case "eth_getBalance":
      return { wei: value.toString(), eth: formatUnits(value, 18) };
    default:
      return undefined;
  }
}

export function buildSpecialistTools(deps: SpecialistDeps): ToolMap {
  return {
    buy_intel: {
      description:
        "Purchase the premium intel feed for a topic. Costs ~0.01 USDC, paid automatically from your delegated budget via x402.",
      parameters: {
        type: "object",
        properties: { topic: { type: "string", description: "research topic slug" } },
        required: ["topic"],
      },
      run: async ({ topic }: { topic: string }) => {
        const url = `${deps.intelBaseUrl}/api/intel/${encodeURIComponent(topic)}`;
        let lastError: unknown;
        for (let attempt = 1; attempt <= BUY_INTEL_ATTEMPTS; attempt++) {
          try {
            const res = await deps.paidFetch(url);
            // Only record a payment for a SUCCESSFUL purchase — never emit a
            // payment.made event for a failed call (misleading audit trail).
            if (!res.ok) throw new Error(`intel purchase failed: HTTP ${res.status}`);
            const paymentHeader = res.headers.get("PAYMENT-RESPONSE");
            if (paymentHeader) {
              try {
                const receipt = JSON.parse(Buffer.from(paymentHeader, "base64").toString()) as {
                  amount?: string;
                  transaction?: string;
                };
                deps.onPayment?.({ url, amount: receipt.amount, tx: receipt.transaction });
              } catch {
                deps.onPayment?.({ url });
              }
            }
            return await res.json();
          } catch (err) {
            lastError = err;
            if (attempt < BUY_INTEL_ATTEMPTS) {
              await sleep(deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
            }
          }
        }
        throw lastError ?? new Error("buy_intel: all attempts exhausted");
      },
    },
    read_chain: {
      description:
        "Read Base Sepolia TESTNET state via JSON-RPC (mainnet contracts are not deployed here). " +
        "Numeric results come pre-decoded (block number, gwei, eth) — quote the decoded values verbatim. " +
        "Allowed: eth_blockNumber, eth_getBalance, eth_call, eth_getCode, eth_getTransactionCount, eth_gasPrice, eth_getLogs.",
      parameters: {
        type: "object",
        properties: {
          method: { type: "string" },
          params: { type: "array", items: {} },
        },
        required: ["method"],
      },
      run: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
        if (!ALLOWED_RPC.has(method)) {
          throw new Error(`rpc method not allowed: ${method}`);
        }
        const result = await deps.publicRpc(method, params);
        const decoded = decodeRpcResult(method, result);
        return {
          network: "Base Sepolia (testnet, chainId 84532)",
          method,
          result,
          ...(decoded ? { decoded } : {}),
        };
      },
    },
    generate_image: {
      description: "Generate a report cover image from a short visual prompt.",
      parameters: {
        type: "object",
        properties: { prompt: { type: "string" } },
        required: ["prompt"],
      },
      // The base64 image must NOT be returned to the model — it would blow the
      // context window. Surface it via onImage and tell the model only that it
      // succeeded.
      run: async ({ prompt }: { prompt: string }) => {
        const image = await deps.venice.generateImage(prompt);
        deps.onImage?.(image);
        return { ok: true, note: "cover image generated" };
      },
    },
  };
}
