import { describe, it, expect, vi } from "vitest";
import { VeniceClient } from "../src/venice.js";

const reply = (content: string, toolCalls?: unknown[]) =>
  ({
    ok: true,
    json: async () => ({
      choices: [{ message: { role: "assistant", content, tool_calls: toolCalls } }],
    }),
  }) as Response;

describe("VeniceClient.chat", () => {
  it("sends messages+tools and returns the assistant message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply("hello"));
    const v = new VeniceClient({ apiKey: "k", fetchImpl: fetchMock as never });
    const msg = await v.chat({ model: "m", messages: [{ role: "user", content: "hi" }] });
    expect(msg.content).toBe("hello");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.venice.ai/api/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body).model).toBe("m");
  });

  it("throws a useful error on non-2xx without leaking the key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      text: async () => "insufficient balance",
    } as Response);
    const v = new VeniceClient({ apiKey: "secret-key", fetchImpl: fetchMock as never });
    const err = await v.chat({ model: "m", messages: [] }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/402/);
    expect((err as Error).message).not.toContain("secret-key");
  });
});

describe("VeniceClient.generateImage", () => {
  it("posts to /image/generate and returns the first image", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ images: ["base64data"] }),
    } as Response);
    const v = new VeniceClient({ apiKey: "k", fetchImpl: fetchMock as never });
    const img = await v.generateImage("abstract cover");
    expect(img).toBe("base64data");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.venice.ai/api/v1/image/generate");
  });
});
