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

const NOW_S = 1_760_000_000;
const NOW_MS = NOW_S * 1000;

async function signedEvent(priv: Uint8Array, overrides: Partial<TestEvent> = {}) {
  const event: TestEvent = {
    apiVersion: 0,
    type: 0,
    data: { id: "0x" + "11".repeat(32), status: 200, memo: "demo" },
    timestamp: NOW_S,
    keyId: "0",
    ...overrides,
  };
  const sig = await ed.signAsync(new TextEncoder().encode(stringify(event)), priv);
  return { ...event, signature: Buffer.from(sig).toString("base64") };
}

describe("verifyWebhook", () => {
  it("accepts a correctly signed, fresh event", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const evt = await signedEvent(priv);
    expect(await verifyWebhook(evt, { "0": pub }, { nowMs: NOW_MS })).toBe(true);
  });

  it("rejects a tampered event", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const evt = await signedEvent(priv);
    evt.data.memo = "tampered";
    expect(await verifyWebhook(evt, { "0": pub }, { nowMs: NOW_MS })).toBe(false);
  });

  it("rejects unknown keyId", async () => {
    const priv = ed.utils.randomPrivateKey();
    const evt = await signedEvent(priv, { keyId: "9" });
    expect(await verifyWebhook(evt, {}, { nowMs: NOW_MS })).toBe(false);
  });

  it("SECURITY: rejects prototype-chain keyIds like __proto__", async () => {
    const priv = ed.utils.randomPrivateKey();
    const evt = await signedEvent(priv, { keyId: "__proto__" });
    expect(await verifyWebhook(evt, {}, { nowMs: NOW_MS })).toBe(false);
  });

  it("SECURITY: rejects stale events (replay guard)", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const evt = await signedEvent(priv);
    const elevenMinutesLater = NOW_MS + 11 * 60_000;
    expect(await verifyWebhook(evt, { "0": pub }, { nowMs: elevenMinutesLater })).toBe(false);
  });

  it("rejects a base64-garbage signature without throwing", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const evt = { ...(await signedEvent(priv)), signature: "!!!not-base64!!!" };
    expect(await verifyWebhook(evt, { "0": pub }, { nowMs: NOW_MS })).toBe(false);
  });
});

describe("WebhookDeduper", () => {
  it("admits an event once per (taskId, type)", () => {
    const d = new WebhookDeduper();
    expect(d.admit("0xaa", 0)).toBe(true);
    expect(d.admit("0xaa", 0)).toBe(false);
    expect(d.admit("0xaa", 4)).toBe(true);
  });

  it("SECURITY: is bounded — old entries are evicted instead of growing forever", () => {
    const d = new WebhookDeduper(3);
    expect(d.admit("a", 0)).toBe(true);
    expect(d.admit("b", 0)).toBe(true);
    expect(d.admit("c", 0)).toBe(true);
    expect(d.admit("d", 0)).toBe(true); // evicts "a"
    expect(d.admit("a", 0)).toBe(true); // "a" was evicted -> admitted again
    expect(d.admit("d", 0)).toBe(false); // "d" still tracked
  });
});
