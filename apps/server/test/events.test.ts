import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { EventBus, sseHandler } from "../src/events.js";

/** Minimal Express req/res doubles for the streaming SSE handler. */
function mockReqRes(query: Record<string, string>) {
  const chunks: string[] = [];
  let closeHandler: (() => void) | undefined;
  const req = {
    query,
    on: (event: string, cb: () => void) => {
      if (event === "close") closeHandler = cb;
    },
  } as unknown as Request;
  const res = {
    writableEnded: false,
    writeHead: vi.fn(),
    // Handler flushes headers immediately so proxies open the stream.
    flushHeaders: vi.fn(),
    write: (s: string) => {
      chunks.push(s);
      return true;
    },
  } as unknown as Response;
  return { req, res, chunks, close: () => closeHandler?.() };
}

describe("EventBus", () => {
  it("delivers published events to subscribers", () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    const unsub = bus.subscribe((e) => seen.push(e));
    bus.publish({ kind: "job.started", jobId: "j1" });
    expect(seen).toHaveLength(1);
    unsub();
    bus.publish({ kind: "report.ready", jobId: "j1" });
    expect(seen).toHaveLength(1);
  });

  it("keeps a bounded replay buffer per job for late subscribers", () => {
    const bus = new EventBus(2);
    bus.publish({ kind: "a", jobId: "j1" });
    bus.publish({ kind: "b", jobId: "j1" });
    bus.publish({ kind: "c", jobId: "j1" }); // evicts "a"
    expect(bus.replay("j1").map((e) => e.kind)).toEqual(["b", "c"]);
    expect(bus.replay("other")).toEqual([]);
  });

  it("a throwing subscriber does not break other subscribers", () => {
    const bus = new EventBus();
    bus.subscribe(() => {
      throw new Error("bad subscriber");
    });
    const ok = vi.fn();
    bus.subscribe(ok);
    bus.publish({ kind: "x", jobId: "j" });
    expect(ok).toHaveBeenCalledOnce();
  });
});

describe("sseHandler", () => {
  it("replays buffered events on connect, then streams live ones for the job", () => {
    const bus = new EventBus();
    bus.publish({ kind: "job.started", jobId: "j1" });
    bus.publish({ kind: "slice.created", jobId: "j1", agent: "scout" });
    bus.publish({ kind: "other", jobId: "j2" }); // different job — must be filtered out

    const { req, res, chunks, close } = mockReqRes({ jobId: "j1" });
    sseHandler(bus)(req, res);

    // replayed history (j1 only)
    expect(chunks.join("")).toContain('"kind":"job.started"');
    expect(chunks.join("")).toContain('"agent":"scout"');
    expect(chunks.join("")).not.toContain('"kind":"other"');

    // live event for j1 is delivered, j2 is filtered
    bus.publish({ kind: "report.ready", jobId: "j1" });
    bus.publish({ kind: "report.ready", jobId: "j2" });
    const j1Reports = chunks.filter((c) => c.includes("report.ready"));
    expect(j1Reports).toHaveLength(1);

    // after close, the subscription is torn down (no further writes)
    close();
    const before = chunks.length;
    bus.publish({ kind: "late", jobId: "j1" });
    expect(chunks.length).toBe(before);
  });
});
