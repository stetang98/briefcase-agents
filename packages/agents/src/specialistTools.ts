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
        return res.json();
      },
    },
    read_chain: {
      description:
        "Read Base chain state via JSON-RPC. Allowed: eth_blockNumber, eth_getBalance, eth_call, eth_getCode, eth_getTransactionCount, eth_gasPrice, eth_getLogs.",
      parameters: {
        type: "object",
        properties: {
          method: { type: "string" },
          params: { type: "array", items: {} },
        },
        required: ["method"],
      },
      run: ({ method, params = [] }: { method: string; params?: unknown[] }) => {
        if (!ALLOWED_RPC.has(method)) {
          return Promise.reject(new Error(`rpc method not allowed: ${method}`));
        }
        return deps.publicRpc(method, params);
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
