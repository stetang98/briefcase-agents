import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import * as ed from "@noble/ed25519";
import stringify from "safe-stable-stringify";
import { EventBus } from "../src/events.js";
import { makeWebhookRouter } from "../src/webhooks.js";

async function makeSigned(priv: Uint8Array, taskId: string, type = 0) {
  const event = {
    apiVersion: 0,
    type,
    data: { id: taskId, status: 200, memo: "job:j1" },
    timestamp: Math.floor(Date.now() / 1000),
    keyId: "0",
  };
  const sig = await ed.signAsync(new TextEncoder().encode(stringify(event)), priv);
  return { ...event, signature: Buffer.from(sig).toString("base64") };
}

async function setup() {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const bus = new EventBus();
  const events: Record<string, unknown>[] = [];
  bus.subscribe((e) => events.push(e));
  const app = express();
  app.use(express.json());
  app.use(makeWebhookRouter(bus, async () => ({ "0": pub })));
  return { app, priv, events };
}

describe("POST /webhooks/oneshot", () => {
  it("verifies a signed event and republishes settlement.update on the bus", async () => {
    const { app, priv, events } = await setup();
    const evt = await makeSigned(priv, "0x" + "aa".repeat(32));
    const res = await request(app).post("/webhooks/oneshot").send(evt);
    expect(res.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "settlement.update", status: 200 });
  });

  it("acks but drops tampered events", async () => {
    const { app, priv, events } = await setup();
    const evt = await makeSigned(priv, "0x" + "bb".repeat(32));
    (evt.data as { memo: string }).memo = "tampered";
    const res = await request(app).post("/webhooks/oneshot").send(evt);
    expect(res.status).toBe(200); // always ack fast — never make the relayer retry forever
    expect(events).toHaveLength(0);
  });

  it("drops duplicate (taskId, type) deliveries", async () => {
    const { app, priv, events } = await setup();
    const evt = await makeSigned(priv, "0x" + "cc".repeat(32));
    await request(app).post("/webhooks/oneshot").send(evt);
    await request(app).post("/webhooks/oneshot").send(evt);
    expect(events).toHaveLength(1);
  });
});
