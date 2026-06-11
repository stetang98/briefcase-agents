import { isAddress, getAddress, parseUnits } from "viem";

export class OneShotRpcError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
    this.name = "OneShotRpcError";
  }
}

export interface OneShotExecution {
  target: string;
  value: string;
  data: string;
}
export interface OneShotAuthorization {
  address: string;
  chainId: number;
  nonce: number;
  r: string;
  s: string;
  yParity: number;
}
export interface OneShotBundle {
  chainId: string;
  transactions: { permissionContext: unknown[]; executions: OneShotExecution[] }[];
  authorizationList?: OneShotAuthorization[];
}
export interface OneShotCapabilities {
  targetAddress: `0x${string}`;
  feeCollector: `0x${string}`;
  tokens: { symbol: string; address: string; decimals?: string }[];
}
export interface EstimateResult {
  success: boolean;
  requiredPaymentAmount: string;
  gasUsed: unknown;
  context: string;
}
/**
 * Live API note (verified 2026-06-10): `minFee` is a DECIMAL string in human
 * units (e.g. "0.01") with `token.decimals` provided, while estimate's
 * `requiredPaymentAmount` is in BASE units. The default fee parser handles
 * both shapes; pass `feeDecimals` matching the payment token.
 */
export interface FeeData {
  minFee: string;
  feeCollector: string;
  targetAddress: string;
  token?: { decimals: number; address: string; symbol: string };
  rate?: number;
  gasPrice?: string;
  expiry?: number;
}
/** Status codes: 100 Pending, 110 Submitted, 200 Confirmed, 400 Rejected, 500 Reverted. */
export interface StatusResult {
  status: number;
  hash?: string;
  receipt?: unknown;
  data?: string;
  memo?: string;
}

export interface EstimateThenSendOptions {
  /**
   * SECURITY: hard ceiling on the fee this client will ever sign a delegation
   * for. The relayer dictates `requiredPaymentAmount`; without a ceiling a
   * compromised relayer could make us sign an arbitrarily large allowance.
   */
  maxFee: bigint;
  /** Decimals used to parse decimal-formatted fee strings (default 6 = USDC). */
  feeDecimals?: number;
  destinationUrl?: string;
  memo?: string;
}

/** Parses both base-unit ("10000") and decimal ("0.01") fee strings. */
export function parseFeeString(s: string, decimals: number): bigint {
  return s.includes(".") ? parseUnits(s, decimals) : BigInt(s);
}

export class OneShotClient {
  private nextId = 0;

  constructor(
    private url: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.nextId, method, params }),
    });
    if (!res.ok) throw new OneShotRpcError(res.status, `HTTP ${res.status}`);
    const j = (await res.json()) as { result?: T; error?: { code: number; message: string } };
    if (j.error) throw new OneShotRpcError(j.error.code, j.error.message);
    return j.result as T;
  }

  async getCapabilities(chainId: number): Promise<OneShotCapabilities> {
    const r = await this.rpc<Record<string, OneShotCapabilities | undefined>>(
      "relayer_getCapabilities",
      [String(chainId)],
    );
    const caps = r?.[String(chainId)];
    if (!caps) throw new OneShotRpcError(4206, `no capabilities for chain ${chainId}`);
    // Injection guard: these addresses end up inside signed delegations.
    if (!isAddress(caps.targetAddress) || !isAddress(caps.feeCollector)) {
      throw new OneShotRpcError(4201, "relayer returned an invalid address in capabilities");
    }
    return {
      ...caps,
      targetAddress: getAddress(caps.targetAddress),
      feeCollector: getAddress(caps.feeCollector),
    };
  }

  getFeeData(chainId: number, token: string): Promise<FeeData> {
    return this.rpc<FeeData>("relayer_getFeeData", { chainId: String(chainId), token });
  }

  estimate(bundle: OneShotBundle): Promise<EstimateResult> {
    return this.rpc<EstimateResult>("relayer_estimate7710Transaction", bundle);
  }

  send(
    bundle: OneShotBundle,
    context: string,
    opts: { destinationUrl?: string; memo?: string } = {},
  ): Promise<string> {
    return this.rpc<string>("relayer_send7710Transaction", { ...bundle, context, ...opts });
  }

  getStatus(id: string): Promise<StatusResult> {
    return this.rpc<StatusResult>("relayer_getStatus", { id, logs: false });
  }

  /**
   * Estimate-first loop with security rails:
   * 1. build+sign at `initialFee`, estimate;
   * 2. if the relayer requires a different fee, verify it is <= `maxFee`,
   *    rebuild ONCE at the exact required fee, re-estimate;
   * 3. if the re-estimate diverges again, ABORT (unstable/malicious fee);
   * 4. send with the latest price-lock context (valid ~45s).
   */
  async estimateThenSend(
    buildSigned: (fee: bigint) => Promise<OneShotBundle>,
    initialFee: bigint,
    opts: EstimateThenSendOptions,
  ): Promise<string> {
    const { maxFee, feeDecimals = 6, destinationUrl, memo } = opts;
    const parse = (s: string) => parseFeeString(s, feeDecimals);
    if (initialFee > maxFee) {
      throw new OneShotRpcError(4200, `initial fee ${initialFee} exceeds maxFee ceiling ${maxFee}`);
    }
    let bundle = await buildSigned(initialFee);
    let est = await this.estimate(bundle);
    const required = parse(est.requiredPaymentAmount);
    if (required !== initialFee) {
      if (required > maxFee) {
        throw new OneShotRpcError(
          4200,
          `relayer demanded fee ${required} exceeds maxFee ceiling ${maxFee}`,
        );
      }
      bundle = await buildSigned(required);
      est = await this.estimate(bundle);
      const finalRequired = parse(est.requiredPaymentAmount);
      if (finalRequired !== required) {
        throw new OneShotRpcError(
          4204,
          `fee unstable: re-signed at ${required}, re-estimate now demands ${finalRequired}`,
        );
      }
    }
    if (!est.success) throw new OneShotRpcError(4211, "simulation failed");
    return this.send(bundle, est.context, { destinationUrl, memo });
  }
}
