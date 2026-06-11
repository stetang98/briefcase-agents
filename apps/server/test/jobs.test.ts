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
    expect(runJob).toHaveBeenCalledWith("job-fixed", "uniswap", expect.anything());
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

  it("marks a job failed when runJob rejects", async () => {
    const { app } = setup(vi.fn().mockRejectedValue(new Error("agent crash")));
    await request(app).post("/api/jobs").send({ topic: "uniswap" });
    await new Promise((r) => setTimeout(r, 10));
    const res = await request(app).get("/api/jobs/job-fixed");
    expect(res.body.status).toBe("failed");
    expect(res.body.error).toMatch(/agent crash/);
  });
});
