import { Router, type Router as RouterType } from "express";
import { randomUUID } from "node:crypto";
import type { EventBus, BriefcaseEvent } from "./events.js";

export interface JobRecord {
  id: string;
  topic: string;
  status: "running" | "done" | "failed";
  report?: { markdown: string; [k: string]: unknown };
  error?: string;
}
export type JobStore = Map<string, JobRecord>;

/** Injectable so tests can stub the (heavy, chain-touching) orchestrator. */
export type RunJobFn = (
  jobId: string,
  topic: string,
  emit: (e: BriefcaseEvent) => void,
) => Promise<{ markdown: string; [k: string]: unknown }>;

export interface JobsDeps {
  bus: EventBus;
  store: JobStore;
  runJob: RunJobFn;
  idFactory?: () => string;
}

const SAFE_TOPIC = /^[a-zA-Z0-9 _-]{1,80}$/;

export function makeJobsRouter(deps: JobsDeps): RouterType {
  const router = Router();
  const newId = deps.idFactory ?? randomUUID;

  router.post("/api/jobs", (req, res) => {
    const topic = typeof req.body?.topic === "string" ? req.body.topic.trim() : "";
    if (!SAFE_TOPIC.test(topic)) {
      res.status(400).json({ error: "topic must be 1-80 chars [a-zA-Z0-9 _-]" });
      return;
    }
    const jobId = newId();
    deps.store.set(jobId, { id: jobId, topic, status: "running" });

    // fire-and-forget; progress streams over SSE, terminal state in the store
    void deps
      .runJob(jobId, topic, (e) => deps.bus.publish(e))
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
      });

    res.status(202).json({ jobId });
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
