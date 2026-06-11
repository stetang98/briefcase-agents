import type { Request, Response } from "express";

export type BriefcaseEvent = Record<string, unknown> & { kind: string; jobId?: string };
type Subscriber = (e: BriefcaseEvent) => void;

/**
 * In-memory pub/sub with a bounded per-job replay buffer so the dashboard can
 * reconnect mid-job without losing the delegation tree state. Both bounds are
 * memory caps for a long-lived free-tier process: events per job AND number
 * of jobs kept (oldest job's buffer evicted first).
 */
export class EventBus {
  private subscribers = new Set<Subscriber>();
  private buffers = new Map<string, BriefcaseEvent[]>();

  constructor(
    private replayLimit = 200,
    private maxBufferedJobs = 100,
  ) {}

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  /** Live subscriber count (used by the SSE handler's connection cap). */
  get subscriberCount(): number {
    return this.subscribers.size;
  }

  publish(e: BriefcaseEvent): void {
    if (typeof e.jobId === "string") {
      const isNewJob = !this.buffers.has(e.jobId);
      const buf = this.buffers.get(e.jobId) ?? [];
      buf.push(e);
      if (buf.length > this.replayLimit) buf.shift();
      // Only set NEW keys: never re-set an existing key, so Map insertion
      // order stays creation order and "first key = oldest job" holds.
      if (isNewJob) {
        this.buffers.set(e.jobId, buf);
        while (this.buffers.size > this.maxBufferedJobs) {
          const oldest = this.buffers.keys().next().value;
          if (oldest === undefined) break;
          this.buffers.delete(oldest);
        }
      }
    }
    for (const fn of this.subscribers) {
      try {
        fn(e);
      } catch {
        // a broken subscriber must never break the others
      }
    }
  }

  replay(jobId: string): BriefcaseEvent[] {
    return this.buffers.get(jobId) ?? [];
  }
}

/**
 * SSE endpoint handler: replays the job's history, then streams live events.
 * `maxClients` bounds concurrent streams — behind nginx/Render, dropped
 * upstreams don't always emit `close`, so zombie subscribers would otherwise
 * accumulate for the life of the free-tier process.
 */
export function sseHandler(bus: EventBus, maxClients = 50) {
  return (req: Request, res: Response): void => {
    if (bus.subscriberCount >= maxClients) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "too many live event streams, retry shortly" }));
      return;
    }
    const jobId = typeof req.query.jobId === "string" ? req.query.jobId : undefined;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      // Reverse proxies (Render/nginx) buffer responses by default, which
      // stalls SSE until the buffer fills — disable it for this stream.
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const write = (e: BriefcaseEvent) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    if (jobId) for (const e of bus.replay(jobId)) write(e);
    const unsub = bus.subscribe((e) => {
      if (!jobId || e.jobId === jobId) write(e);
    });
    const keepalive = setInterval(() => {
      if (!res.writableEnded) res.write(": keepalive\n\n");
    }, 25_000);
    req.on("close", () => {
      clearInterval(keepalive);
      unsub();
    });
  };
}
