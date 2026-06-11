import type { Request, Response } from "express";

export type BriefcaseEvent = Record<string, unknown> & { kind: string; jobId?: string };
type Subscriber = (e: BriefcaseEvent) => void;

/**
 * In-memory pub/sub with a bounded per-job replay buffer so the dashboard can
 * reconnect mid-job without losing the delegation tree state.
 */
export class EventBus {
  private subscribers = new Set<Subscriber>();
  private buffers = new Map<string, BriefcaseEvent[]>();

  constructor(private replayLimit = 200) {}

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  publish(e: BriefcaseEvent): void {
    if (typeof e.jobId === "string") {
      const buf = this.buffers.get(e.jobId) ?? [];
      buf.push(e);
      if (buf.length > this.replayLimit) buf.shift();
      this.buffers.set(e.jobId, buf);
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

/** SSE endpoint handler: replays the job's history, then streams live events. */
export function sseHandler(bus: EventBus) {
  return (req: Request, res: Response): void => {
    const jobId = typeof req.query.jobId === "string" ? req.query.jobId : undefined;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
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
