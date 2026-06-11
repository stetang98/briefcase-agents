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
  // Generation counter: revoke/reset bump it so SSE callbacks already queued
  // for the old job can't clobber the phase after the user moved on.
  const jobGenRef = useRef(0);
  // Reset epoch: bumped ONLY by onReset (jobGenRef is also bumped by normal
  // start/revoke flows, so run() can't use it to detect an abandoning reset).
  const resetEpochRef = useRef(0);

  const states = useMemo(() => deriveAgentStates(events), [events]);

  const closeStream = () => {
    unsubRef.current?.();
    unsubRef.current = null;
  };

  // Close any open SSE connection on unmount.
  useEffect(() => () => unsubRef.current?.(), []);

  const TOPIC_RE = /^[a-zA-Z0-9_-]{1,64}$/;

  async function run<T>(fn: () => Promise<T>) {
    const epoch = resetEpochRef.current;
    setError(undefined);
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      // A reset mid-flight must not have its clean state overwritten by the
      // error of the call it abandoned.
      if (epoch !== resetEpochRef.current) return undefined;
      setError(e instanceof Error ? e.message : "Something went wrong");
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const onConnect = () =>
    run(async () => {
      const gen = jobGenRef.current;
      const addr = await connectWallet();
      if (gen !== jobGenRef.current) return; // reset while the popup was open
      setUser(addr);
      setPhase("connected");
    });

  const onGrant = () =>
    run(async () => {
      const gen = jobGenRef.current;
      const g = await requestBudgetGrant();
      if (gen !== jobGenRef.current) return; // reset while the popup was open
      setGrant(g);
      setRevoked(false);
      setPhase("granted");
    });

  const onStart = () => {
    if (!TOPIC_RE.test(topic)) {
      setError("Topic must be 1–64 chars: letters, numbers, _ or - (no spaces).");
      return;
    }
    return run(async () => {
      closeStream(); // close any prior SSE before starting a new job
      setEvents([]);
      setReport(null);
      setRevoked(false);
      const gen = ++jobGenRef.current;
      const jobId = await startJob(topic);
      if (gen !== jobGenRef.current) {
        // Reset fired while dispatching: the job exists server-side but the
        // reset couldn't know its id — cancel the orphan ourselves.
        void cancelJob(jobId).catch(() => undefined);
        return;
      }
      jobIdRef.current = jobId;
      setPhase("running");
      const unsub = subscribeEvents(jobId, async (e) => {
        if (gen !== jobGenRef.current) return; // stale stream (revoked/reset)
        setEvents((prev) => [...prev, e]);
        if (e.kind === "report.ready") {
          const rep = await fetchReport(jobId);
          if (gen !== jobGenRef.current) return;
          setReport(rep);
          setPhase("done");
          closeStream();
        }
        if (e.kind === "job.failed" || e.kind === "job.revoked") {
          setPhase("done");
          closeStream();
        }
      });
      unsubRef.current = unsub;
    });
  };

  const onRevoke = () =>
    run(async () => {
      setRevoked(true);
      const gen = ++jobGenRef.current; // invalidate in-flight SSE callbacks
      closeStream();
      // 1) stop the running job server-side; even if the server is down, the
      //    on-chain revoke below still removes the spending authority itself
      if (jobIdRef.current) await cancelJob(jobIdRef.current).catch(() => undefined);
      // 2) revoke the 7715 grant on-chain so the authority is gone
      if (grant) await revokeGrant(grant.context);
      if (gen !== jobGenRef.current) return; // reset while revoking
      jobIdRef.current = null;
      // Back to "connected": revoke requires a grant, which requires a
      // connected wallet — granting a fresh budget restarts the demo.
      setGrant(undefined);
      setPhase("connected");
      setError("Permission revoked — the agent team can no longer spend the budget. Grant again to restart.");
    });

  // Full in-app reset: the escape hatch from ANY stuck state — including a
  // hung request — so it never awaits and is never disabled. Continuations of
  // in-flight calls are invalidated via the generation counter.
  const onReset = () => {
    resetEpochRef.current++;
    jobGenRef.current++;
    closeStream();
    // Best-effort job cancel in the background; Revoke is the guaranteed path.
    if (jobIdRef.current) void cancelJob(jobIdRef.current).catch(() => undefined);
    jobIdRef.current = null;
    setUser(undefined);
    setGrant(undefined);
    setEvents([]);
    setReport(null);
    setRevoked(false);
    setError(undefined);
    setBusy(false); // un-stick a hung request; its continuation is gen-guarded
    setPhase("idle");
  };

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
                disabled={!grant || (phase !== "granted" && phase !== "done")}
                className="topic-input mono"
                placeholder="topic e.g. uniswap"
              />
              <button
                onClick={onStart}
                disabled={busy || !grant || (phase !== "granted" && phase !== "done")}
                className="btn btn-primary"
              >
                3 · Dispatch team
              </button>
            </div>
          </li>
        </ol>
        <div className="control-row">
          <button onClick={onRevoke} disabled={busy || !grant} className="btn btn-danger">
            Revoke permission (kill switch)
          </button>
          <button
            onClick={onReset}
            className="btn btn-ghost"
            title="Disconnect and start the demo over"
          >
            Reset
          </button>
        </div>
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
