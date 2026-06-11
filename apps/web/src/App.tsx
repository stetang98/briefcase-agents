import { useEffect, useMemo, useRef, useState } from "react";
import { connectWallet, requestBudgetGrant, revokeGrant, type GrantedPermission } from "./lib/grant.js";
import {
  startJob,
  subscribeEvents,
  fetchReport,
  cancelJob,
  type BriefcaseEvent,
  type JobReport,
} from "./lib/api.js";
import { DelegationTree, deriveAgentStates } from "./components/DelegationTree.js";
import { EventFeed } from "./components/EventFeed.js";
import { ReportView } from "./components/ReportView.js";
import "./App.css";

type Phase = "idle" | "connected" | "granted" | "running" | "done";

export default function App() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [user, setUser] = useState<string>();
  const [grant, setGrant] = useState<GrantedPermission>();
  const [topic, setTopic] = useState("uniswap");
  const [events, setEvents] = useState<BriefcaseEvent[]>([]);
  const [report, setReport] = useState<JobReport | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const unsubRef = useRef<(() => void) | null>(null);
  const jobIdRef = useRef<string | null>(null);

  const states = useMemo(() => deriveAgentStates(events), [events]);

  // Close any open SSE connection on unmount.
  useEffect(() => () => unsubRef.current?.(), []);

  const TOPIC_RE = /^[a-zA-Z0-9_-]{1,64}$/;

  async function run<T>(fn: () => Promise<T>) {
    setError(undefined);
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const onConnect = () =>
    run(async () => {
      const addr = await connectWallet();
      setUser(addr);
      setPhase("connected");
    });

  const onGrant = () =>
    run(async () => {
      const g = await requestBudgetGrant();
      setGrant(g);
      setPhase("granted");
    });

  const onStart = () => {
    if (!TOPIC_RE.test(topic)) {
      setError("Topic must be 1–64 chars: letters, numbers, _ or - (no spaces).");
      return;
    }
    return run(async () => {
      unsubRef.current?.(); // close any prior SSE before starting a new job
      setEvents([]);
      setReport(null);
      setRevoked(false);
      const jobId = await startJob(topic);
      jobIdRef.current = jobId;
      setPhase("running");
      const unsub = subscribeEvents(jobId, async (e) => {
        setEvents((prev) => [...prev, e]);
        if (e.kind === "report.ready") {
          setReport(await fetchReport(jobId));
          setPhase("done");
          unsubRef.current?.();
        }
        if (e.kind === "job.failed" || e.kind === "job.revoked") {
          setPhase("done");
          unsubRef.current?.();
        }
      });
      unsubRef.current = unsub;
    });
  };

  const onRevoke = () =>
    run(async () => {
      setRevoked(true);
      // 1) guaranteed: stop the running job server-side (no more spending)
      if (jobIdRef.current) await cancelJob(jobIdRef.current);
      // 2) best-effort: revoke the 7715 grant on-chain so the authority is gone
      if (grant) await revokeGrant(grant.context);
      unsubRef.current?.();
      setError("Permission revoked — the agent team can no longer spend the budget.");
    });

  return (
    <div className="app">
      <header className="hero">
        <p className="kicker mono">MetaMask Smart Accounts × 1Shot · x402 · Venice</p>
        <h1 className="hero-title">Briefcase</h1>
        <p className="hero-sub">
          Grant a budget once. Hire an autonomous AI research team that buys its own
          intelligence, data, and gas — and that you can revoke in one click.
        </p>
      </header>

      <section className="controls" aria-label="Demo controls">
        <ol className="steps">
          <li className={phase !== "idle" ? "step-done" : "step-active"}>
            <button onClick={onConnect} disabled={busy || phase !== "idle"} className="btn btn-primary">
              1 · Connect MetaMask
            </button>
          </li>
          <li className={phase === "granted" || phase === "running" || phase === "done" ? "step-done" : phase === "connected" ? "step-active" : ""}>
            <button onClick={onGrant} disabled={busy || phase !== "connected"} className="btn btn-primary">
              2 · Grant 10 USDC/day (ERC-7715)
            </button>
          </li>
          <li className={phase === "running" || phase === "done" ? "step-active" : ""}>
            <div className="topic-row">
              <input
                aria-label="Research topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                disabled={phase !== "granted" && phase !== "done"}
                className="topic-input mono"
                placeholder="topic e.g. uniswap"
              />
              <button
                onClick={onStart}
                disabled={busy || (phase !== "granted" && phase !== "done")}
                className="btn btn-primary"
              >
                3 · Dispatch team
              </button>
            </div>
          </li>
        </ol>
        <button onClick={onRevoke} disabled={!grant || revoked} className="btn btn-danger">
          Revoke permission (kill switch)
        </button>
      </section>

      {error && <div className="banner" role="alert">{error}</div>}

      <main className="grid">
        <section className="panel panel-tree" aria-label="Delegation tree">
          <h2 className="panel-title">Delegation &amp; budget flow</h2>
          <DelegationTree
            connected={phase !== "idle"}
            granted={!!grant}
            userAddress={user}
            states={states}
            revoked={revoked}
          />
        </section>

        <section className="panel" aria-label="Activity feed">
          <h2 className="panel-title">Live activity</h2>
          <EventFeed events={events} />
        </section>

        {report && (
          <section className="panel panel-report" aria-label="Research report">
            <h2 className="panel-title">Deliverable</h2>
            <ReportView report={report} />
          </section>
        )}
      </main>
    </div>
  );
}
