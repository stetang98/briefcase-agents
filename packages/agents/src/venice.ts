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

  constructor(opts: { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch }) {
    this.apiKey = opts.apiKey;
    this.base = opts.baseUrl ?? "https://api.venice.ai/api/v1";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Venice ${path} failed: ${res.status} ${detail.slice(0, 200)}`);
    }
    return res.json() as Promise<T>;
  }

  async chat(req: ChatRequest): Promise<VeniceMessage> {
    const j = await this.post<{ choices: { message: VeniceMessage }[] }>(
      "/chat/completions",
      req,
    );
    return j.choices[0].message;
  }

  async generateImage(prompt: string, model = "z-image-turbo"): Promise<string> {
    const j = await this.post<{ images: string[] }>("/image/generate", {
      model,
      prompt,
      format: "webp",
    });
    return j.images[0];
  }
}
