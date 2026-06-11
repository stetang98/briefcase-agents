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
  targetAddress: string;
  feeCollector: string;
  tokens: { symbol: string; address: string }[];
}
export interface EstimateResult {
  success: boolean;
  requiredPaymentAmount: string;
  gasUsed: string;
  context: string;
}
export interface FeeData {
  minFee: string;
  feeCollector: string;
  targetAddress: string;
}
/** Status codes: 100 Pending, 110 Submitted, 200 Confirmed, 400 Rejected, 500 Reverted. */
export interface StatusResult {
  status: number;
  hash?: string;
  receipt?: unknown;
  data?: string;
  memo?: string;
}

export class OneShotClient {
  constructor(
    private url: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) throw new OneShotRpcError(res.status, `HTTP ${res.status}`);
    const j = (await res.json()) as { result?: T; error?: { code: number; message: string } };
    if (j.error) throw new OneShotRpcError(j.error.code, j.error.message);
    return j.result as T;
  }

  async getCapabilities(chainId: number): Promise<OneShotCapabilities> {
    const r = await this.rpc<Record<string, OneShotCapabilities>>("relayer_getCapabilities", [
      String(chainId),
    ]);
    return r[String(chainId)];
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
   * Estimate-first loop: build+sign a bundle at a fee, estimate; if the relayer
   * requires a different fee, rebuild ONCE at the exact required fee and re-estimate.
   * Sends with the latest price-lock context (valid ~45s).
   */
  async estimateThenSend(
    buildSigned: (fee: bigint) => Promise<OneShotBundle>,
    initialFee: bigint,
    opts: { destinationUrl?: string; memo?: string } = {},
  ): Promise<string> {
    let bundle = await buildSigned(initialFee);
    let est = await this.estimate(bundle);
    if (BigInt(est.requiredPaymentAmount) !== initialFee) {
      bundle = await buildSigned(BigInt(est.requiredPaymentAmount));
      est = await this.estimate(bundle);
    }
    if (!est.success) throw new OneShotRpcError(4211, "simulation failed");
    return this.send(bundle, est.context, opts);
  }
}
