import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { EventBus } from "../src/events.js";
import { makeJobsRouter, type JobStore } from "../src/jobs.js";

function setup(runJob = vi.fn().mockResolvedValue({ markdown: "# done", sections: [] })) {
  const bus = new EventBus();
  const store: JobStore = new Map();
  const app = express();
  app.use(express.json());
  app.use(makeJobsRouter({ bus, store, runJob, idFactory: () => "job-fixed" }));
  return { app, store, runJob, bus };
}

describe("jobs API", () => {
  it("POST /api/jobs validates the topic", async () => {
    const { app } = setup();
    const res = await request(app).post("/api/jobs").send({ topic: "" });
    expect(res.status).toBe(400);
  });

  it("POST /api/jobs accepts a job, returns an id, runs it async", async () => {
    const { app, runJob } = setup();
    const res = await request(app).post("/api/jobs").send({ topic: "uniswap" });
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBe("job-fixed");
    // allow the fire-and-forget run to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(runJob).toHaveBeenCalledWith(
      "job-fixed",
      "uniswap",
      expect.anything(),
      expect.any(AbortSignal),
    );
  });

  it("GET /api/jobs/:id reports status and final report", async () => {
    const { app } = setup();
    await request(app).post("/api/jobs").send({ topic: "uniswap" });
    await new Promise((r) => setTimeout(r, 10));
    const res = await request(app).get("/api/jobs/job-fixed");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("done");
    expect(res.body.report.markdown).toBe("# done");
  });

  it("GET /api/jobs/:id returns 404 for unknown jobs", async () => {
    const { app } = setup();
    const res = await request(app).get("/api/jobs/nope");
    expect(res.status).toBe(404);
  });

  it("POST /api/jobs/:id/cancel aborts the run and marks it failed (kill switch)", async () => {
    let captured: AbortSignal | undefined;
    const runJob = vi.fn(
      (_id: string, _topic: string, _emit: unknown, signal: AbortSignal) => {
        captured = signal;
        return new Promise<{ markdown: string }>(() => {}); // never resolves — long job
      },
    );
    const { app, store } = setup(runJob as never);
    await request(app).post("/api/jobs").send({ topic: "uniswap" });
    await new Promise((r) => setTimeout(r, 10));

    const res = await request(app).post("/api/jobs/job-fixed/cancel");
    expect(res.status).toBe(200);
    expect(captured?.aborted).toBe(true);
    expect(store.get("job-fixed")?.status).toBe("failed");
  });

  it("cancel returns 404 for unknown jobs", async () => {
    const { app } = setup();
    const res = await request(app).post("/api/jobs/nope/cancel");
    expect(res.status).toBe(404);
  });

  it("marks a job failed when runJob rejects", async () => {
    const { app } = setup(vi.fn().mockRejectedValue(new Error("agent crash")));
    await request(app).post("/api/jobs").send({ topic: "uniswap" });
    await new Promise((r) => setTimeout(r, 10));
    const res = await request(app).get("/api/jobs/job-fixed");
    expect(res.body.status).toBe("failed");
    expect(res.body.error).toMatch(/agent crash/);
  });
});
