import { Router, type Router as RouterType, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import type { EventBus, BriefcaseEvent } from "./events.js";

/** Minimal report shape the server stores and returns (matches CompiledReport structurally). */
export interface JobReportLike {
  markdown: string;
  topic?: string;
  coverImage?: string;
  sections?: unknown[];
}

export interface JobRecord {
  id: string;
  topic: string;
  status: "running" | "done" | "failed";
  report?: JobReportLike;
  error?: string;
}
export type JobStore = Map<string, JobRecord>;

/** Injectable so tests can stub the (heavy, chain-touching) orchestrator. */
export type RunJobFn = (
  jobId: string,
  topic: string,
  emit: (e: BriefcaseEvent) => void,
  signal: AbortSignal,
) => Promise<JobReportLike>;

export interface JobsDeps {
  bus: EventBus;
  store: JobStore;
  runJob: RunJobFn;
  idFactory?: () => string;
  /** Optional per-route limiter for POST /api/jobs (cost protection). */
  postLimiter?: RequestHandler;
}

// Must match the intel route's allowlist so an accepted topic is always fulfillable.
const SAFE_TOPIC = /^[a-zA-Z0-9_-]{1,64}$/;

export function makeJobsRouter(deps: JobsDeps): RouterType {
  const router = Router();
  const newId = deps.idFactory ?? randomUUID;
  const limiter: RequestHandler = deps.postLimiter ?? ((_req, _res, next) => next());
  const controllers = new Map<string, AbortController>();

  router.post("/api/jobs", limiter, (req, res) => {
    const topic = typeof req.body?.topic === "string" ? req.body.topic.trim() : "";
    if (!SAFE_TOPIC.test(topic)) {
      res.status(400).json({ error: "topic must be 1-64 chars [a-zA-Z0-9_-]" });
      return;
    }
    const jobId = newId();
    deps.store.set(jobId, { id: jobId, topic, status: "running" });
    const controller = new AbortController();
    controllers.set(jobId, controller);

    // fire-and-forget; progress streams over SSE, terminal state in the store
    void deps
      .runJob(jobId, topic, (e) => deps.bus.publish(e), controller.signal)
      .then((report) => {
        deps.store.set(jobId, { id: jobId, topic, status: "done", report });
      })
      .catch((err: unknown) => {
        deps.store.set(jobId, {
          id: jobId,
          topic,
          status: "failed",
          error: err instanceof Error ? err.message : "job failed",
        });
        deps.bus.publish({ kind: "job.failed", jobId });
      })
      .finally(() => controllers.delete(jobId));

    res.status(202).json({ jobId });
  });

  // Kill switch: abort the running job so it stops spending immediately.
  router.post("/api/jobs/:id/cancel", (req, res) => {
    const controller = controllers.get(req.params.id);
    const record = deps.store.get(req.params.id);
    if (!record) {
      res.status(404).json({ error: "job not found" });
      return;
    }
    controller?.abort();
    if (record.status === "running") {
      deps.store.set(req.params.id, { ...record, status: "failed", error: "revoked by user" });
    }
    deps.bus.publish({ kind: "job.revoked", jobId: req.params.id });
    res.json({ ok: true });
  });

  router.get("/api/jobs/:id", (req, res) => {
    const record = deps.store.get(req.params.id);
    if (!record) {
      res.status(404).json({ error: "job not found" });
      return;
    }
    res.json(record);
  });

  return router;
}
