import type { BriefcaseEvent } from "../lib/api.js";
import "./delegation-tree.css";

const AGENTS = [
  { name: "scout", label: "Scout", role: "intelligence", color: "var(--color-scout)" },
  { name: "analyst", label: "Analyst", role: "on-chain", color: "var(--color-analyst)" },
  { name: "designer", label: "Designer", role: "visuals", color: "var(--color-designer)" },
] as const;

export interface AgentState {
  slice?: string;
  status: "idle" | "working" | "done" | "failed";
  payments: { amount?: string; url: string; tx?: string }[];
}

export type AgentStates = Record<string, AgentState>;

export function deriveAgentStates(events: BriefcaseEvent[]): AgentStates {
  const states: AgentStates = {};
  const ensure = (a: string): AgentState =>
    (states[a] ??= { status: "idle", payments: [] });
  for (const e of events) {
    if (!e.agent) continue;
    const s = ensure(e.agent);
    if (e.kind === "slice.created") s.slice = e.amount;
    if (e.kind === "agent.started") s.status = "working";
    if (e.kind === "agent.finished") s.status = "done";
    if (e.kind === "agent.failed") s.status = "failed";
    if (e.kind === "payment.made") s.payments.push({ amount: e.amount, url: e.url ?? "", tx: e.tx });
  }
  return states;
}

function usdc(raw?: string): string {
  if (!raw) return "—";
  return `${(Number(raw) / 1e6).toFixed(2)} USDC`;
}

interface Props {
  connected: boolean;
  granted: boolean;
  userAddress?: string;
  states: AgentStates;
  revoked: boolean;
}

export function DelegationTree({ connected, granted, userAddress, states, revoked }: Props) {
  return (
    <div className="tree" role="img" aria-label="Permission and budget delegation tree">
      <div className={`node node-user ${granted ? "node-active" : ""} ${revoked ? "node-revoked" : ""}`}>
        <span className="node-tag">USER · MetaMask</span>
        <span className="mono node-addr">{userAddress ? short(userAddress) : "not connected"}</span>
        <span className="node-meta">{granted ? "7715 grant · 10 USDC/day" : connected ? "ready to grant" : "—"}</span>
      </div>

      <div className={`edge edge-trunk ${granted && !revoked ? "edge-live" : ""}`} aria-hidden />

      <div className={`node node-chief ${granted ? "node-active" : ""}`}>
        <span className="node-tag">CHIEF agent</span>
        <span className="node-meta">redelegates budget slices</span>
      </div>

      <div className="branches" aria-hidden>
        {AGENTS.map((a) => {
          const st = states[a.name];
          const live = granted && !revoked && st?.status === "working";
          return <div key={a.name} className={`edge edge-branch ${live ? "edge-live" : ""}`} />;
        })}
      </div>

      <div className="specialists">
        {AGENTS.map((a) => {
          const st = states[a.name] ?? { status: "idle", payments: [] };
          return (
            <div
              key={a.name}
              className={`node node-spec status-${st.status}`}
              style={{ "--spec-color": a.color } as React.CSSProperties}
            >
              <span className="node-tag" style={{ color: a.color }}>
                {a.label}
              </span>
              <span className="node-meta">{a.role}</span>
              <span className="mono node-slice">{usdc(st.slice)}</span>
              <span className={`badge badge-${st.status}`}>{st.status}</span>
              {st.payments.length > 0 && (
                <span className="node-pay mono">
                  ✓ {st.payments.length} x402 paid
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
