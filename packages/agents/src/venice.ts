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

/** Minimal Venice API client (OpenAI-compatible chat + native image gen). */
export class VeniceClient {
  private base: string;
  private apiKey: string;
  private fetchImpl: typeof fetch;

  private timeoutMs: number;

  constructor(opts: {
    apiKey: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }) {
    this.apiKey = opts.apiKey;
    this.base = opts.baseUrl ?? "https://api.venice.ai/api/v1";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 45_000;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
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
