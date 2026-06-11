# Briefcase Plan 2: Agents + Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Venice-powered agent team (Chief + Scout/Analyst/Designer) that plans budget slices, redelegates (A2A), buys resources via x402, compiles a research report, and settles payroll via 1Shot — exposed through server job + SSE event APIs.

**Architecture:** `packages/agents` holds a generic tool-calling agent loop over Venice's OpenAI-compatible API plus the Chief orchestrator. `apps/server` gains an in-memory job store, an SSE event bus (drives the delegation-tree UI in Plan 3), and the 1Shot webhook receiver. All chain primitives come from `@briefcase/chain` (Plan 1, spike-verified).

**Tech Stack:** Venice API (`/chat/completions`, `/image/generate`), `@briefcase/chain`, Express SSE, vitest with mocked fetch.

**Spike-informed constraints (from `docs/superpowers/spikes/2026-06-10-live-spikes.md`):**
- All agent wallets are `make7702SmartAccount` accounts, upgraded on-chain via 1Shot before first x402 payment.
- `estimateThenSend(…, parseUnits(minFee, token.decimals), opts)`; `requiredPaymentAmount` is base units.
- Specialists pay via `makePaidFetch({ account })` (own funds) or `{ account, parentPermissionContext, from }` (user grant / redelegation) — both compile against the same provider.

---

## File Structure

```
packages/agents/
├── package.json  tsconfig.json  (deps: @briefcase/chain workspace:*, viem; dev: vitest)
├── src/venice.ts        Venice REST client: chat(+tools), generateImage; fetch injectable
├── src/agentLoop.ts     generic loop: system+task → venice.chat → dispatch tools → final text; caps
├── src/tools.ts         ToolSpec type + buildSpecialistTools(deps) (buy_intel, read_chain, generate_image)
├── src/specialists.ts   SPECIALISTS: scout/analyst/designer {name, system, tools, budget weight}
├── src/chief.ts         runJob(): plan slices → redelegate → run specialists → compile report
├── src/report.ts        compileReport(): merge specialist outputs into markdown + meta
└── test/                venice.test.ts, agentLoop.test.ts, chief.test.ts, report.test.ts
apps/server/src/
├── events.ts            EventBus (typed events) + SSE handler GET /api/events?jobId=
├── jobs.ts              POST /api/jobs {topic} → runs chief async; GET /api/jobs/:id
├── webhooks.ts          POST /webhooks/oneshot → verifyWebhook + dedupe → bus
└── index.ts (modify)    mount events/jobs/webhooks BEFORE paymentMiddleware
```

Event vocabulary (single source of truth, used by Plan 3 UI):

```ts
type BriefcaseEvent =
  | { kind: "job.started"; jobId: string; topic: string }
  | { kind: "slice.created"; jobId: string; agent: string; amount: string; delegationHash: string }
  | { kind: "agent.started" | "agent.finished" | "agent.failed"; jobId: string; agent: string; note?: string }
  | { kind: "payment.made"; jobId: string; agent: string; amount: string; url: string; tx?: string }
  | { kind: "settlement.update"; jobId: string; taskId: string; status: number; tx?: string }
  | { kind: "report.ready"; jobId: string };
```

---

### Task 1: `packages/agents` scaffold + Venice client (TDD)

**Files:** `packages/agents/package.json`, `tsconfig.json`, `src/venice.ts`, `test/venice.test.ts`

- [ ] **Step 1: package.json** — name `@briefcase/agents`, type module, main `src/index.ts`, scripts.test `vitest run`, deps `@briefcase/chain workspace:*`, `viem ^2.52.2`; dev `vitest ^3.2.0`, `typescript ^5.8.0`. tsconfig extends base, include src+test. Run `pnpm install`.
- [ ] **Step 2: failing test**

```ts
// test/venice.test.ts
import { describe, it, expect, vi } from "vitest";
import { VeniceClient } from "../src/venice.js";

const reply = (content: string, toolCalls?: unknown[]) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { role: "assistant", content, tool_calls: toolCalls } }] }),
}) as Response;

describe("VeniceClient.chat", () => {
  it("sends messages+tools and returns the assistant message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply("hello"));
    const v = new VeniceClient({ apiKey: "k", fetchImpl: fetchMock as never });
    const msg = await v.chat({ model: "m", messages: [{ role: "user", content: "hi" }] });
    expect(msg.content).toBe("hello");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.venice.ai/api/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer k");
  });
  it("throws a useful error on non-2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 402, text: async () => "balance" } as Response);
    const v = new VeniceClient({ apiKey: "k", fetchImpl: fetchMock as never });
    await expect(v.chat({ model: "m", messages: [] })).rejects.toThrow(/402/);
  });
});
```

- [ ] **Step 3: run → FAIL**, then implement

```ts
// src/venice.ts
export interface VeniceMessage { role: "system" | "user" | "assistant" | "tool"; content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string; }
export interface VeniceTool { type: "function"; function: { name: string; description: string; parameters: unknown } }
export interface ChatRequest { model: string; messages: VeniceMessage[]; tools?: VeniceTool[];
  tool_choice?: "auto"; temperature?: number }

export class VeniceClient {
  private base: string; private apiKey: string; private fetchImpl: typeof fetch;
  constructor(opts: { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch }) {
    this.apiKey = opts.apiKey; this.base = opts.baseUrl ?? "https://api.venice.ai/api/v1";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }
  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Venice ${path} failed: ${res.status} ${await res.text().catch(() => "")}`);
    return res.json() as Promise<T>;
  }
  async chat(req: ChatRequest): Promise<VeniceMessage> {
    const j = await this.post<{ choices: { message: VeniceMessage }[] }>("/chat/completions", req);
    return j.choices[0].message;
  }
  async generateImage(prompt: string, model = "z-image-turbo"): Promise<string /* base64 or url */> {
    const j = await this.post<{ images: string[] }>("/image/generate", { model, prompt, format: "webp" });
    return j.images[0];
  }
}
```

- [ ] **Step 4: tests PASS → commit** `feat(agents): Venice client (chat + image)`

### Task 2: agent loop with tool dispatch + caps (TDD)

**Files:** `src/agentLoop.ts`, `src/tools.ts`, `test/agentLoop.test.ts`

- [ ] **Step 1: failing tests** — (a) loop executes a tool call then returns final content; (b) stops with error note after `maxSteps`; (c) tool errors are reported to the model as tool messages, not thrown.

```ts
// test/agentLoop.test.ts (core case)
import { describe, it, expect, vi } from "vitest";
import { runAgentLoop } from "../src/agentLoop.js";
const toolCallMsg = { role: "assistant", content: null,
  tool_calls: [{ id: "1", type: "function", function: { name: "echo", arguments: '{"x":"hi"}' } }] };
const finalMsg = { role: "assistant", content: "done: hi" };
it("dispatches tool calls then returns the final message", async () => {
  const chat = vi.fn().mockResolvedValueOnce(toolCallMsg).mockResolvedValueOnce(finalMsg);
  const result = await runAgentLoop({
    venice: { chat } as never, model: "m", system: "s", task: "t", maxSteps: 5,
    tools: { echo: { description: "", parameters: {}, run: async (a: { x: string }) => ({ echoed: a.x }) } },
  });
  expect(result.text).toBe("done: hi");
  expect(result.steps).toBe(2);
});
```

- [ ] **Step 2: implement**

```ts
// src/tools.ts
export interface ToolImpl { description: string; parameters: unknown; run: (args: never) => Promise<unknown> }
export type ToolMap = Record<string, ToolImpl>;
export const toVeniceTools = (tools: ToolMap) =>
  Object.entries(tools).map(([name, t]) => ({ type: "function" as const,
    function: { name, description: t.description, parameters: t.parameters } }));
```

```ts
// src/agentLoop.ts
import type { VeniceClient, VeniceMessage } from "./venice.js";
import { toVeniceTools, type ToolMap } from "./tools.js";

export interface AgentLoopOptions { venice: VeniceClient; model: string; system: string; task: string;
  tools: ToolMap; maxSteps?: number; onEvent?: (e: { type: string; detail?: string }) => void }
export interface AgentResult { text: string; steps: number; failed?: boolean }

export async function runAgentLoop(o: AgentLoopOptions): Promise<AgentResult> {
  const messages: VeniceMessage[] = [
    { role: "system", content: o.system }, { role: "user", content: o.task }];
  const max = o.maxSteps ?? 8;
  for (let step = 1; step <= max; step++) {
    const msg = await o.venice.chat({ model: o.model, messages,
      tools: toVeniceTools(o.tools), tool_choice: "auto" });
    messages.push(msg);
    if (!msg.tool_calls?.length) return { text: msg.content ?? "", steps: step };
    for (const call of msg.tool_calls) {
      const tool = o.tools[call.function.name];
      let content: string;
      try {
        const args = JSON.parse(call.function.arguments || "{}");
        content = JSON.stringify(tool ? await tool.run(args) : { error: `unknown tool ${call.function.name}` });
      } catch (err) {
        content = JSON.stringify({ error: err instanceof Error ? err.message : "tool failed" });
      }
      o.onEvent?.({ type: "tool", detail: call.function.name });
      messages.push({ role: "tool", content, tool_call_id: call.id });
    }
  }
  return { text: "Step limit reached before completion.", steps: max, failed: true };
}
```

- [ ] **Step 3: tests PASS → commit** `feat(agents): tool-calling agent loop with step caps`

### Task 3: specialist tool belt + definitions

**Files:** `src/specialists.ts`, modify `src/tools.ts` (add `buildSpecialistTools`), `test/specialists.test.ts`

- [ ] **Step 1: failing test** — `buildSpecialistTools` returns `buy_intel`/`read_chain`/`generate_image`; `buy_intel.run` calls the injected paidFetch with `${intelBaseUrl}/api/intel/<topic>` and returns parsed JSON.
- [ ] **Step 2: implement**

```ts
// src/tools.ts (append)
import type { VeniceClient } from "./venice.js";
export interface SpecialistDeps { paidFetch: typeof fetch; intelBaseUrl: string; venice: VeniceClient;
  publicRpc: (method: string, params: unknown[]) => Promise<unknown>;
  onPayment?: (info: { url: string; amount?: string; tx?: string }) => void }

export function buildSpecialistTools(deps: SpecialistDeps): ToolMap {
  return {
    buy_intel: {
      description: "Purchase the premium intel feed for a topic (paid via x402 delegation).",
      parameters: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
      run: async ({ topic }: { topic: string }) => {
        const res = await deps.paidFetch(`${deps.intelBaseUrl}/api/intel/${encodeURIComponent(topic)}`);
        const paymentHeader = res.headers.get("PAYMENT-RESPONSE");
        if (paymentHeader) {
          const receipt = JSON.parse(Buffer.from(paymentHeader, "base64").toString());
          deps.onPayment?.({ url: res.url, amount: receipt.amount, tx: receipt.transaction });
        }
        if (!res.ok) throw new Error(`intel purchase failed: ${res.status}`);
        return res.json();
      },
    },
    read_chain: {
      description: "Read Base chain state via JSON-RPC (eth_getBalance, eth_call, eth_blockNumber...).",
      parameters: { type: "object", properties: { method: { type: "string" }, params: { type: "array" } },
        required: ["method"] },
      run: ({ method, params = [] }: { method: string; params?: unknown[] }) => deps.publicRpc(method, params),
    },
    generate_image: {
      description: "Generate a report cover image from a prompt.",
      parameters: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] },
      run: async ({ prompt }: { prompt: string }) => ({ image: await deps.venice.generateImage(prompt) }),
    },
  };
}
```

```ts
// src/specialists.ts
export interface SpecialistSpec { name: "scout" | "analyst" | "designer"; weight: number;
  system: string; toolNames: string[] }
export const SPECIALISTS: SpecialistSpec[] = [
  { name: "scout", weight: 3, toolNames: ["buy_intel"],
    system: "You are Scout, a crypto intelligence agent. Buy the premium intel feed for the topic and summarize the 3 most decision-relevant findings as bullet points. Be concrete." },
  { name: "analyst", weight: 2, toolNames: ["read_chain", "buy_intel"],
    system: "You are Analyst, an on-chain data agent. Use read_chain to ground at least two quantitative observations (block height, balances, contract state). State numbers explicitly." },
  { name: "designer", weight: 1, toolNames: ["generate_image"],
    system: "You are Designer. Generate one tasteful abstract cover image for the report topic, then reply with a one-line caption. Return the caption only." },
];
```

- [ ] **Step 3: tests PASS → commit** `feat(agents): specialist tool belt and team definitions`

### Task 4: Chief orchestrator + report compiler (TDD)

**Files:** `src/chief.ts`, `src/report.ts`, `src/index.ts`, `test/chief.test.ts`, `test/report.test.ts`

- [ ] **Step 1: failing tests** — chief with injected fakes: (a) emits `slice.created` per specialist with amounts proportional to weight within total budget (uses real `planSlices`/`buildSliceDelegation` against unsigned check); (b) runs all specialists and emits `agent.finished`; (c) a throwing specialist yields `agent.failed` + report section noting failure (job still completes); report test: compileReport merges sections + cover.
- [ ] **Step 2: implement**

```ts
// src/chief.ts
import { parseUnits, type Hex } from "viem";
import { planSlices, buildSliceDelegation, hashDelegationSafe } from "@briefcase/chain";
import { runAgentLoop } from "./agentLoop.js";
import { buildSpecialistTools, type SpecialistDeps } from "./tools.js";
import { SPECIALISTS } from "./specialists.js";
import { compileReport, type ReportSection } from "./report.js";
import type { VeniceClient } from "./venice.js";

export interface ChiefDeps {
  venice: VeniceClient; model: string;
  chiefAccount: { address: Hex; environment: unknown; signDelegation: (a: { delegation: unknown }) => Promise<Hex> };
  specialistDeps: (name: string, sliceContext?: unknown) => SpecialistDeps;
  tokenAddress: Hex; totalBudget: bigint;
  emit: (e: Record<string, unknown> & { kind: string }) => void;
  settle?: () => Promise<void>;
}

export async function runJob(jobId: string, topic: string, d: ChiefDeps) {
  d.emit({ kind: "job.started", jobId, topic });
  const unit = d.totalBudget / BigInt(SPECIALISTS.reduce((s, x) => s + x.weight, 0));
  const slices = planSlices(d.totalBudget,
    SPECIALISTS.map((s) => ({ name: s.name, amount: unit * BigInt(s.weight) })));

  const sections: ReportSection[] = [];
  for (const spec of SPECIALISTS) {
    const slice = slices.find((s) => s.name === spec.name)!;
    const delegation = buildSliceDelegation({
      from: d.chiefAccount as never, toAddress: d.chiefAccount.address, // Plan 3 wires real specialist addrs
      tokenAddress: d.tokenAddress, amount: slice.amount, salt: slice.salt,
    });
    const signature = await d.chiefAccount.signDelegation({ delegation });
    d.emit({ kind: "slice.created", jobId, agent: spec.name, amount: slice.amount.toString(),
      delegationHash: hashDelegationSafe({ ...delegation, signature }) });

    d.emit({ kind: "agent.started", jobId, agent: spec.name });
    try {
      const deps = d.specialistDeps(spec.name, { ...delegation, signature });
      const allTools = buildSpecialistTools({ ...deps,
        onPayment: (p) => d.emit({ kind: "payment.made", jobId, agent: spec.name, ...p }) });
      const tools = Object.fromEntries(Object.entries(allTools)
        .filter(([k]) => spec.toolNames.includes(k)));
      const result = await runAgentLoop({ venice: d.venice, model: d.model,
        system: spec.system, task: `Research topic: ${topic}`, tools });
      sections.push({ agent: spec.name, text: result.text, failed: result.failed });
      d.emit({ kind: result.failed ? "agent.failed" : "agent.finished", jobId, agent: spec.name });
    } catch (err) {
      sections.push({ agent: spec.name, text: "", failed: true,
        note: err instanceof Error ? err.message : "failed" });
      d.emit({ kind: "agent.failed", jobId, agent: spec.name });
    }
  }
  const report = compileReport(topic, sections);
  await d.settle?.().catch(() => d.emit({ kind: "settlement.update", jobId, taskId: "", status: 400 }));
  d.emit({ kind: "report.ready", jobId });
  return report;
}
```

(`hashDelegationSafe` = thin wrapper in `@briefcase/chain` around `hashDelegation` returning hex, add it in this task. `report.ts`: `compileReport(topic, sections)` → `{ markdown, sections, generatedAt }`, failures rendered as "⚠ section unavailable".)

- [ ] **Step 3: tests PASS → commit** `feat(agents): chief orchestrator with A2A slices and degradable sections`

### Task 5: server events + jobs + webhook receiver (TDD)

**Files:** `apps/server/src/events.ts`, `jobs.ts`, `webhooks.ts`, modify `index.ts`; `apps/server/test/events.test.ts`, `webhooks.test.ts`

- [ ] **Step 1: failing tests** — (a) EventBus: subscribe receives published events, jobId-filtered; (b) GET /api/events streams `data:` lines (supertest, read first chunk); (c) POST /webhooks/oneshot: valid Ed25519 event → 200 + republished on bus; tampered → still 200 (ack) but dropped; duplicate `(id,type)` dropped.
- [ ] **Step 2: implement** — EventBus = tiny typed pub/sub over `Set<fn>`; SSE handler sets `Content-Type: text/event-stream`, writes `data: ${JSON.stringify(e)}\n\n`, cleans up on `close`. jobs.ts holds `Map<jobId, {status, report?}>`, generates ids via `crypto.randomUUID()`, runs `runJob` fire-and-forget with deps built from env (Venice key, chief 7702 account, paidFetch per specialist, public RPC via viem `publicClient.request`). webhooks.ts uses `fetchJwks` (cache once) + `verifyWebhook` + `WebhookDeduper` from `@briefcase/chain`, emits `settlement.update`. Mount all three in `buildApp` BEFORE `paymentMiddleware` so they stay free; keep `/api/intel/:topic` behind the paywall.
- [ ] **Step 3: tests PASS; `pnpm -r test && pnpm typecheck` green → commit** `feat(server): job runner, SSE events, 1Shot webhook receiver`

### Task 6: LIVE smoke — full job on Base Sepolia

**Files:** `scripts/spike-full-job.ts`, append findings to spike notes

- [ ] **Step 1:** script boots server (or assumes running), POSTs `/api/jobs {topic:"uniswap"}`, tails `/api/events` printing each event, exits on `report.ready`, prints the report markdown.
- [ ] **Step 2:** Run with `VENICE_API_KEY` set (or document blocked-on-funding if Venice unfunded; the x402/1Shot legs are already spike-proven). Expected event order: job.started → slice.created×3 → agent/payment interleave → report.ready.
- [ ] **Step 3:** record actual Venice model used (resolve via `/models/traits` `function_calling_default`), token cost, latency; commit `test: full job live smoke`.

### Task 7: wrap-up gate

- [ ] `pnpm -r test && pnpm typecheck` green; commit `chore: plan 2 complete`; write Plan 3 (web UI + 7715 grant flow + mainnet settlement + demo assets) using the now-stable event vocabulary.

---

## Self-Review Notes

- **Spec coverage:** spec §5(2) slices → Task 4; §5(3) procurement → Tasks 3–4; §5(4) Venice loops → Tasks 1–2; §5(5) compile+SSE → Tasks 4–5; §6 agent degradation → Task 4(c); webhooks → Task 5. The 7715 browser grant + real specialist wallets + mainnet settlement are Plan 3 (browser/UI scope) — Task 4 notes the `toAddress` placeholder explicitly.
- **Placeholders:** none blocking; Task 4's `toAddress: chiefAccount.address` is a declared, tested interim (slices redeem correctly only in Plan 3 when specialist wallets exist — unit tests assert construction, not redemption).
- **Type consistency:** `ToolMap`/`buildSpecialistTools` shared between Tasks 2–4; event `kind` strings match the vocabulary block; `hashDelegationSafe` added where first used.
