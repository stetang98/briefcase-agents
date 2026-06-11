/** In production set VITE_API_URL to the backend origin (e.g. https://briefcase-api.up.railway.app).
 *  In dev the Vite proxy forwards /api → localhost:4021, so the empty string works. */
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export interface BriefcaseEvent {
  kind: string;
  jobId?: string;
  agent?: string;
  amount?: string;
  delegationHash?: string;
  url?: string;
  tx?: string;
  taskId?: string;
  status?: number;
  detail?: string;
}

export interface JobReport {
  topic: string;
  markdown: string;
  coverImage?: string;
  sections: { agent: string; text: string; failed?: boolean; note?: string }[];
}

/** Submit a research job; returns its id. */
export async function startJob(topic: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `job submit failed: ${res.status}`);
  }
  const json = (await res.json()) as { jobId: string };
  return json.jobId;
}

/** Kill switch: tell the backend to abort the running job (stop all spending). */
export async function cancelJob(jobId: string): Promise<void> {
  await fetch(`${API_BASE}/api/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }).catch(() => {});
}

export async function fetchReport(jobId: string): Promise<JobReport | null> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}`);
  if (!res.ok) return null;
  const json = (await res.json()) as { status: string; report?: JobReport };
  return json.report ?? null;
}

/** Subscribe to the live SSE event stream for a job. Returns an unsubscribe fn. */
export function subscribeEvents(jobId: string, onEvent: (e: BriefcaseEvent) => void): () => void {
  const source = new EventSource(`${API_BASE}/api/events?jobId=${encodeURIComponent(jobId)}`);
  source.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as BriefcaseEvent);
    } catch {
      /* ignore keepalive / malformed frames */
    }
  };
  source.onerror = () => {
    onEvent({ kind: "job.failed", detail: "connection to server lost" });
    source.close();
  };
  return () => source.close();
}
