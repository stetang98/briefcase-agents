import * as ed from "@noble/ed25519";
import stringify from "safe-stable-stringify";

/** 1Shot webhook event types: 4 = Submitted, 0 = Confirmed, 1 = Reverted. */
export interface WebhookEvent {
  apiVersion: number;
  type: number;
  data: { id: string; [k: string]: unknown };
  timestamp: number;
  keyId: string;
  signature: string;
}

/** Verify an Ed25519-signed 1Shot webhook. Keys map: keyId -> raw public key bytes. */
export async function verifyWebhook(
  event: Record<string, unknown>,
  keys: Record<string, Uint8Array>,
): Promise<boolean> {
  const { signature, ...rest } = event as WebhookEvent & Record<string, unknown>;
  const pub = keys[String(event.keyId)];
  if (!pub || typeof signature !== "string") return false;
  try {
    return await ed.verifyAsync(
      Uint8Array.from(Buffer.from(signature, "base64")),
      new TextEncoder().encode(stringify(rest)),
      pub,
    );
  } catch {
    return false;
  }
}

/** Fetch + cache the relayer JWKS (Ed25519, OKP). */
export async function fetchJwks(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, Uint8Array>> {
  const origin = new URL(baseUrl).origin;
  const res = await fetchImpl(`${origin}/.well-known/jwks.json`);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const jwks = (await res.json()) as { keys: { kid: string; x: string }[] };
  const map: Record<string, Uint8Array> = {};
  for (const k of jwks.keys) map[k.kid] = Uint8Array.from(Buffer.from(k.x, "base64url"));
  return map;
}

/** Webhook delivery is at-least-once -> dedupe on (taskId, type). */
export class WebhookDeduper {
  private seen = new Set<string>();
  admit(taskId: string, type: number): boolean {
    const key = `${taskId}:${type}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}
