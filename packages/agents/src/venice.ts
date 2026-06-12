export interface VeniceMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}
export interface VeniceTool {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}
export interface ChatRequest {
  model: string;
  messages: VeniceMessage[];
  tools?: VeniceTool[];
  tool_choice?: "auto";
  temperature?: number;
}

/** Wallet capable of eip191 message signing (viem LocalAccount-compatible). */
export interface SiweSigner {
  address: `0x${string}`;
  signMessage: (args: { message: string }) => Promise<`0x${string}`>;
}

/** Auth: Bearer API key, or wallet auth against an x402 top-up balance. */
export type VeniceAuth = { apiKey: string } | { walletAccount: SiweSigner };

/**
 * Build the X-Sign-In-With-X header (EIP-4361 over eip191, Base mainnet).
 * Nonces are single-use server-side, so a fresh one is generated per request.
 * Note: hand-rolled message — Venice nonces may contain '-', which strict
 * SIWE helpers reject; the server accepts client-generated nonces.
 */
async function buildSiweHeader(signer: SiweSigner, uri: string): Promise<string> {
  const now = new Date();
  const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 17);
  const message =
    `api.venice.ai wants you to sign in with your Ethereum account:\n` +
    `${signer.address}\n\n` +
    `Sign in to Venice AI\n\n` +
    `URI: ${uri}\n` +
    `Version: 1\n` +
    `Chain ID: 8453\n` +
    `Nonce: ${nonce}\n` +
    `Issued At: ${now.toISOString()}\n` +
    `Expiration Time: ${new Date(now.getTime() + 5 * 60_000).toISOString()}`;
  const signature = await signer.signMessage({ message });
  return Buffer.from(
    JSON.stringify({
      address: signer.address,
      message,
      signature,
      timestamp: Date.now(),
      chainId: 8453,
    }),
  ).toString("base64");
}

/** Transient upstream conditions worth retrying (capacity / gateway blips). */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** Abortable sleep: the kill switch must cut retry backoff short, not wait it out. */
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("venice call aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("venice call aborted");
  }
};

/** Minimal Venice API client (OpenAI-compatible chat + native image gen). */
export class VeniceClient {
  private base: string;
  private auth: VeniceAuth;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;
  private retryDelaysMs: number[];

  constructor(
    opts: VeniceAuth & {
      baseUrl?: string;
      fetchImpl?: typeof fetch;
      timeoutMs?: number;
      /** Backoff between retries of transient upstream errors (429/5xx). */
      retryDelaysMs?: number[];
    },
  ) {
    this.auth = opts;
    this.base = opts.baseUrl ?? "https://api.venice.ai/api/v1";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.retryDelaysMs = opts.retryDelaysMs ?? [2_000, 5_000, 12_000];
  }

  private async authHeaders(url: string): Promise<Record<string, string>> {
    if ("apiKey" in this.auth && this.auth.apiKey) {
      return { Authorization: `Bearer ${this.auth.apiKey}` };
    }
    if ("walletAccount" in this.auth) {
      return { "X-Sign-In-With-X": await buildSiweHeader(this.auth.walletAccount, url) };
    }
    throw new Error("VeniceClient requires apiKey or walletAccount");
  }

  /**
   * POST with retry on transient upstream errors. Only HTTP-level statuses are
   * retried; transport errors (timeout, DNS) fail fast — a retried 120s timeout
   * would multiply worst-case latency for little gain. The job's kill-switch
   * signal aborts in-flight requests AND cuts backoff sleeps short.
   */
  private async post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const url = `${this.base}${path}`;
    const payload = JSON.stringify(body);
    let lastError = new Error(`Venice ${path} failed: no attempt made`);
    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt++) {
      throwIfAborted(signal);
      if (attempt > 0) await sleep(this.retryDelaysMs[attempt - 1], signal);
      // Auth headers rebuilt per attempt: SIWE nonces are single-use.
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await this.authHeaders(url)) },
        body: payload,
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)])
          : AbortSignal.timeout(this.timeoutMs),
      });
      if (res.ok) return res.json() as Promise<T>;
      const detail = await res.text().catch(() => "");
      lastError = new Error(`Venice ${path} failed: ${res.status} ${detail.slice(0, 200)}`);
      if (!RETRYABLE_STATUS.has(res.status)) throw lastError;
    }
    throw lastError;
  }

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<VeniceMessage> {
    const j = await this.post<{ choices?: { message: VeniceMessage }[] }>(
      "/chat/completions",
      req,
      signal,
    );
    if (!j.choices?.length) throw new Error("Venice returned no chat choices");
    return j.choices[0].message;
  }

  async generateImage(
    prompt: string,
    model = "z-image-turbo",
    signal?: AbortSignal,
  ): Promise<string> {
    const j = await this.post<{ images?: string[] }>(
      "/image/generate",
      // hide_watermark drops the model's "Venice" signature so the cover stays
      // pure abstract art (the prompt asks for no text; the watermark is added
      // post-generation, not promptable away). Venice may still ignore it for
      // some content — the prompt's no-text rule remains the primary guard.
      { model, prompt, format: "webp", hide_watermark: true },
      signal,
    );
    if (!j.images?.length) throw new Error("Venice returned no images");
    return j.images[0];
  }
}
