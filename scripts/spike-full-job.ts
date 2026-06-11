// LIVE E2E: POST a research job to the running server, tail the SSE event
// stream, and print the final report. Prereq: server running with orchestrator
// enabled (DEV_CHIEF_PK + DEV_BUYER_PK in env).
const BASE = process.env.SERVER_URL ?? "http://localhost:4021";

const res = await fetch(`${BASE}/api/jobs`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ topic: process.env.TOPIC ?? "uniswap" }),
});
if (res.status !== 202) throw new Error(`job submit failed: ${res.status} ${await res.text()}`);
const { jobId } = (await res.json()) as { jobId: string };
console.log("jobId:", jobId);

const stream = await fetch(`${BASE}/api/events?jobId=${jobId}`);
const reader = stream.body!.getReader();
const decoder = new TextDecoder();
let buffer = "";
const deadline = Date.now() + 5 * 60_000;

outer: while (Date.now() < deadline) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let idx: number;
  while ((idx = buffer.indexOf("\n\n")) >= 0) {
    const frame = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    if (!frame.startsWith("data: ")) continue;
    const event = JSON.parse(frame.slice(6)) as Record<string, unknown> & { kind: string };
    console.log(
      `[${event.kind}]`,
      Object.entries(event)
        .filter(([k]) => k !== "kind" && k !== "jobId")
        .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)
        .join(" "),
    );
    if (event.kind === "report.ready" || event.kind === "job.failed") break outer;
  }
}
await reader.cancel().catch(() => {});

const job = await fetch(`${BASE}/api/jobs/${jobId}`).then((r) => r.json() as Promise<{
  status: string;
  report?: { markdown: string; coverImage?: string };
  error?: string;
}>);
console.log("\n=== job status:", job.status, job.error ?? "");
console.log(job.report?.markdown ?? "(no report)");
console.log("\ncover image:", job.report?.coverImage ? `${job.report.coverImage.length} bytes` : "none");
