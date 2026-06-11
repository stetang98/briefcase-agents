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

  it("evicts the oldest completed jobs beyond the store cap, never running ones", async () => {
    let n = 0;
    const pending: Array<() => void> = [];
    const runJob = vi.fn(
      (id: string) =>
        new Promise<{ markdown: string }>((resolve) => {
          // job-3 stays running; earlier jobs resolve immediately
          if (id === "job-3") pending.push(() => resolve({ markdown: "# late" }));
          else resolve({ markdown: "# done" });
        }),
    );
    const bus = new EventBus();
    const store: JobStore = new Map();
    const app = express();
    app.use(express.json());
    app.use(
      makeJobsRouter({ bus, store, runJob, idFactory: () => `job-${++n}`, maxStoredJobs: 2 }),
    );

    await request(app).post("/api/jobs").send({ topic: "one" }); // job-1, completes
    await new Promise((r) => setTimeout(r, 10));
    await request(app).post("/api/jobs").send({ topic: "two" }); // job-2, completes
    await new Promise((r) => setTimeout(r, 10));
    await request(app).post("/api/jobs").send({ topic: "three" }); // job-3, running
    await new Promise((r) => setTimeout(r, 10));
    await request(app).post("/api/jobs").send({ topic: "four" }); // job-4, completes
    await new Promise((r) => setTimeout(r, 10));

    // Cap 2 with 4 jobs: oldest COMPLETED (job-1, job-2) evicted; the running
    // job-3 survives even though it is older than job-4.
    expect((await request(app).get("/api/jobs/job-1")).status).toBe(404);
    expect((await request(app).get("/api/jobs/job-2")).status).toBe(404);
    expect((await request(app).get("/api/jobs/job-3")).body.status).toBe("running");
    expect((await request(app).get("/api/jobs/job-4")).body.status).toBe("done");
    pending.forEach((r) => r());
  });

  it("caps concurrent running jobs with 503 (cost/memory protection)", async () => {
    let n = 0;
    const runJob = vi.fn(() => new Promise<{ markdown: string }>(() => {})); // never resolves
    const bus = new EventBus();
    const store: JobStore = new Map();
    const app = express();
    app.use(express.json());
    app.use(
      makeJobsRouter({ bus, store, runJob, idFactory: () => `job-${++n}`, maxConcurrentJobs: 1 }),
    );
    const first = await request(app).post("/api/jobs").send({ topic: "one" });
    expect(first.status).toBe(202);
    const second = await request(app).post("/api/jobs").send({ topic: "two" });
    expect(second.status).toBe(503);
    expect(second.body.error).toMatch(/busy/i);
    // the rejected job must not pollute the store
    expect(store.size).toBe(1);
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
