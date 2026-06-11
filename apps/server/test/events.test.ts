import { describe, it, expect, vi } from "vitest";
import { EventBus } from "../src/events.js";

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
