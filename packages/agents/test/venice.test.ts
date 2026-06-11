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

describe("VeniceClient wallet auth (SIWE)", () => {
  const walletAccount = {
    address: "0x14B8269984c2FE6A277c99376B6ff74A7f2FA28b" as const,
    signMessage: vi.fn().mockResolvedValue("0x" + "ab".repeat(65)),
  };

  it("attaches X-Sign-In-With-X with a fresh nonce per request (no Authorization)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply("ok"));
    const v = new VeniceClient({ walletAccount, fetchImpl: fetchMock as never });
    await v.chat({ model: "m", messages: [] });
    await v.chat({ model: "m", messages: [] });

    const headers1 = fetchMock.mock.calls[0][1].headers;
    const headers2 = fetchMock.mock.calls[1][1].headers;
    expect(headers1.Authorization).toBeUndefined();
    const payload1 = JSON.parse(Buffer.from(headers1["X-Sign-In-With-X"], "base64").toString());
    const payload2 = JSON.parse(Buffer.from(headers2["X-Sign-In-With-X"], "base64").toString());
    expect(payload1.address).toBe(walletAccount.address);
    expect(payload1.chainId).toBe(8453);
    expect(payload1.message).toContain("api.venice.ai wants you to sign in");
    expect(payload1.message).toContain(walletAccount.address);
    // fresh nonce per request — single-use server-side
    const nonce = (m: string) => /Nonce: (\S+)/.exec(m)?.[1];
    expect(nonce(payload1.message)).toBeDefined();
    expect(nonce(payload1.message)).not.toBe(nonce(payload2.message));
  });
});

describe("VeniceClient error guards", () => {
  it("throws when Venice returns no chat choices", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [] }),
    } as Response);
    const v = new VeniceClient({ apiKey: "k", fetchImpl: fetchMock as never });
    await expect(v.chat({ model: "m", messages: [] })).rejects.toThrow(/no chat choices/);
  });

  it("throws when Venice returns no images", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ images: [] }),
    } as Response);
    const v = new VeniceClient({ apiKey: "k", fetchImpl: fetchMock as never });
    await expect(v.generateImage("x")).rejects.toThrow(/no images/);
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
