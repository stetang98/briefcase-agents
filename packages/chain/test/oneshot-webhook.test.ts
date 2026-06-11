import { describe, it, expect } from "vitest";
import * as ed from "@noble/ed25519";
import stringify from "safe-stable-stringify";
import { verifyWebhook, WebhookDeduper } from "../src/oneshot/webhook.js";

interface TestEvent {
  apiVersion: number;
  type: number;
  data: { id: string; status: number; memo: string };
  timestamp: number;
  keyId: string;
  signature?: string;
}

async function signedEvent(priv: Uint8Array, overrides: Partial<TestEvent> = {}) {
  const event: TestEvent = {
    apiVersion: 0,
    type: 0,
    data: { id: "0x" + "11".repeat(32), status: 200, memo: "demo" },
    timestamp: 1760000000,
    keyId: "0",
    ...overrides,
  };
  const sig = await ed.signAsync(new TextEncoder().encode(stringify(event)), priv);
  return { ...event, signature: Buffer.from(sig).toString("base64") };
}

describe("verifyWebhook", () => {
  it("accepts a correctly signed event", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const evt = await signedEvent(priv);
    expect(await verifyWebhook(evt, { "0": pub })).toBe(true);
  });

  it("rejects a tampered event", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const evt = await signedEvent(priv);
    evt.data.memo = "tampered";
    expect(await verifyWebhook(evt, { "0": pub })).toBe(false);
  });

  it("rejects unknown keyId", async () => {
    const priv = ed.utils.randomPrivateKey();
    const evt = await signedEvent(priv, { keyId: "9" });
    expect(await verifyWebhook(evt, {})).toBe(false);
  });
});

describe("WebhookDeduper", () => {
  it("admits an event once per (taskId, type)", () => {
    const d = new WebhookDeduper();
    expect(d.admit("0xaa", 0)).toBe(true);
    expect(d.admit("0xaa", 0)).toBe(false);
    expect(d.admit("0xaa", 4)).toBe(true);
  });
});
