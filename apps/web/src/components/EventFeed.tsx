import type { BriefcaseEvent } from "../lib/api.js";
import "./event-feed.css";

const LABELS: Record<string, string> = {
  "job.started": "Job started",
  "slice.created": "Budget slice redelegated",
  "agent.started": "Agent started",
  "agent.finished": "Agent finished",
  "agent.failed": "Agent failed",
  "agent.tool": "Tool call",
  "payment.made": "x402 payment settled",
  "settlement.update": "1Shot settlement",
  "report.ready": "Report ready",
  "job.failed": "Job failed",
};

function describe(e: BriefcaseEvent): string {
  const who = e.agent ? `${e.agent}` : "";
  switch (e.kind) {
    case "slice.created":
      return `${who} ← ${(Number(e.amount) / 1e6).toFixed(2)} USDC (${e.delegationHash?.slice(0, 10)}…)`;
    case "payment.made":
      return `${who} paid ${e.amount ? (Number(e.amount) / 1e6).toFixed(2) + " USDC" : ""} ${e.tx ? "· " + e.tx.slice(0, 10) + "…" : ""}`;
    case "settlement.update":
      return `task ${e.taskId?.slice(0, 10)}… status ${e.status}${e.tx ? " · " + e.tx.slice(0, 10) + "…" : ""}`;
    case "agent.tool":
      return `${who} · ${e.detail}`;
    default:
      return who;
  }
}

export function EventFeed({ events }: { events: BriefcaseEvent[] }) {
  return (
    <ol className="feed" aria-live="polite">
      {events.length === 0 && <li className="feed-empty muted">No activity yet.</li>}
      {events.map((e, i) => (
        <li key={i} className={`feed-row kind-${e.kind.split(".")[0]}`}>
          <span className="feed-dot" aria-hidden />
          <span className="feed-label">{LABELS[e.kind] ?? e.kind}</span>
          <span className="feed-detail mono">{describe(e)}</span>
        </li>
      ))}
    </ol>
  );
}
