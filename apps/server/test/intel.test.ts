import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildApp } from "../src/index.js";

describe("intel API payment gate", () => {
  const app = buildApp({ payTo: ("0x" + "22".repeat(20)) as `0x${string}` });

  it("returns 402 with payment requirements when unpaid", async () => {
    const res = await request(app).get("/api/intel/uniswap");
    expect(res.status).toBe(402);
    // v2 SDKs use the PAYMENT-REQUIRED header; adapt assertion to the actual SDK behavior.
    const header = res.headers["payment-required"];
    expect(header).toBeDefined();
    const decoded = JSON.parse(Buffer.from(header, "base64").toString());
    expect(decoded.accepts?.length).toBeGreaterThan(0);
    expect(decoded.accepts[0].extra?.assetTransferMethod).toBe("erc7710");
  });

  it("healthz is free", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
