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

/** Minimal Venice API client (OpenAI-compatible chat + native image gen). */
export class VeniceClient {
  private base: string;
  private auth: VeniceAuth;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;

  constructor(
    opts: VeniceAuth & {
      baseUrl?: string;
      fetchImpl?: typeof fetch;
      timeoutMs?: number;
    },
  ) {
    this.auth = opts;
    this.base = opts.baseUrl ?? "https://api.venice.ai/api/v1";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
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

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.base}${path}`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await this.authHeaders(url)) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Venice ${path} failed: ${res.status} ${detail.slice(0, 200)}`);
    }
    return res.json() as Promise<T>;
  }

  async chat(req: ChatRequest): Promise<VeniceMessage> {
    const j = await this.post<{ choices?: { message: VeniceMessage }[] }>(
      "/chat/completions",
      req,
    );
    if (!j.choices?.length) throw new Error("Venice returned no chat choices");
    return j.choices[0].message;
  }

  async generateImage(prompt: string, model = "z-image-turbo"): Promise<string> {
    const j = await this.post<{ images?: string[] }>("/image/generate", {
      model,
      prompt,
      format: "webp",
    });
    if (!j.images?.length) throw new Error("Venice returned no images");
    return j.images[0];
  }
}
