# Briefcase Plan 1: Core Payment Rails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Working, tested payment plumbing — an x402-gated API (seller), a delegation-paying HTTP client (buyer), delegation slicing for A2A, and a 1Shot relayer client with verified webhooks — proven end-to-end on Base Sepolia.

**Architecture:** pnpm monorepo. `packages/chain` wraps all Web3 SDKs behind small typed modules; `apps/server` hosts the x402-gated intel API. Riskiest integrations (tx-sentinel facilitator round-trip, 1Shot relay) are validated by live spike scripts at the end of this plan, before Plans 2–3 are written.

**Tech Stack:** TypeScript, pnpm workspaces, viem, `@metamask/smart-accounts-kit`, `@metamask/x402`, `@x402/core`/`@x402/express`/`@x402/fetch`, Express, vitest, supertest, `@noble/ed25519`, `safe-stable-stringify`.

---

## File Structure

```
briefcase/  (repo root = /Users/stetang/Desktop/hackquest)
├── package.json                  workspace root, scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .gitignore  .env.example
├── packages/chain/
│   ├── package.json  tsconfig.json
│   ├── src/config.ts             chains, env access, addresses (single source of truth)
│   ├── src/accounts.ts           smart-account + EOA session account factories
│   ├── src/slicing.ts            redelegation slicing (A2A core) + validation
│   ├── src/paidFetch.ts          x402 buyer client factory (7710 delegations)
│   ├── src/oneshot/client.ts     1Shot JSON-RPC client (typed methods, estimate-first loop)
│   ├── src/oneshot/webhook.ts    Ed25519 webhook verification + dedupe
│   └── test/ *.test.ts           unit tests per module
├── apps/server/
│   ├── package.json  tsconfig.json
│   ├── src/index.ts              Express bootstrap
│   ├── src/intel.ts              x402-gated intel API routes (seller)
│   ├── src/intelData.ts          curated intel payload generator
│   └── test/intel.test.ts        402-challenge tests (supertest)
└── scripts/
    ├── gen-dev-keys.ts           create burner dev keys → .env
    ├── spike-x402-roundtrip.ts   LIVE: buyer pays our API via 7710 on Base Sepolia
    └── spike-1shot-relay.ts      LIVE: 7702 upgrade + relayed 7710 bundle on Sepolia testnet relayer
```

Environment facts verified during research (2026-06-10):
- 1Shot testnet relayer: `https://relayer.1shotapi.dev/relayers` (no auth); mainnet: `https://relayer.1shotapi.com/relayers`.
- MetaMask x402 facilitator (Base Sepolia): `https://tx-sentinel-base-sepolia.api.cx.metamask.io/platform/v2/x402`.
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (Circle faucet: faucet.circle.com).

---

### Task 0: Environment prerequisites

**Files:**
- Create: `scripts/gen-dev-keys.ts`, `.env.example`, `.gitignore`

- [ ] **Step 1: Write `.gitignore` and `.env.example`**

```gitignore
node_modules/
dist/
.env
*.local
.DS_Store
```

```bash
# .env.example — copy to .env and fill
DEV_BUYER_PK=        # burner EOA for buyer smart account (Base Sepolia)
DEV_CHIEF_PK=        # burner EOA for Chief settlement wallet
SERVER_PAYTO=        # address that receives intel-API payments
WEBHOOK_URL=         # public URL for 1Shot webhooks (ngrok/cloudflared during dev)
VENICE_API_KEY=      # optional in Plan 1
```

- [ ] **Step 2: Write key generator**

```ts
// scripts/gen-dev-keys.ts
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { appendFileSync, existsSync } from "node:fs";

const names = ["DEV_BUYER_PK", "DEV_CHIEF_PK"] as const;
if (existsSync(".env")) {
  console.error(".env already exists — refusing to overwrite. Delete it first if intentional.");
  process.exit(1);
}
let out = "";
for (const name of names) {
  const pk = generatePrivateKey();
  const addr = privateKeyToAccount(pk).address;
  out += `${name}=${pk}\n`;
  console.log(`${name} address: ${addr}`);
}
appendFileSync(".env", out);
console.log("Wrote .env — fund the printed addresses on Base Sepolia (ETH + USDC faucets).");
```

- [ ] **Step 3: Run it after Task 1 scaffolding (`pnpm tsx scripts/gen-dev-keys.ts`), record printed addresses**
- [ ] **Step 4: Fund both addresses: Base Sepolia ETH (any faucet) + USDC (faucet.circle.com → Base Sepolia). Verify balances:**

Run: `cast balance <addr> --rpc-url https://sepolia.base.org` (or a viem one-liner via tsx)
Expected: nonzero ETH on buyer; ≥2 USDC on buyer.

- [ ] **Step 5: Commit (scripts + examples only — never `.env`)**

```bash
git add .gitignore .env.example scripts/gen-dev-keys.ts
git commit -m "chore: dev key generation and env scaffolding"
```

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `packages/chain/package.json`, `packages/chain/tsconfig.json`, `apps/server/package.json`, `apps/server/tsconfig.json`

- [ ] **Step 1: Root files**

```json
// package.json
{
  "name": "briefcase",
  "private": true,
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r exec tsc --noEmit"
  },
  "devDependencies": { "tsx": "^4", "typescript": "^5", "vitest": "^3" }
}
```

```yaml
# pnpm-workspace.yaml
packages: ["packages/*", "apps/*"]
```

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "skipLibCheck": true, "esModuleInterop": true,
    "resolveJsonModule": true, "declaration": true, "outDir": "dist"
  }
}
```

- [ ] **Step 2: `packages/chain/package.json`** (pin exact versions at install time with `pnpm add -E`)

```json
{
  "name": "@briefcase/chain",
  "type": "module",
  "main": "src/index.ts",
  "scripts": { "test": "vitest run" },
  "dependencies": {
    "@metamask/smart-accounts-kit": "*",
    "@metamask/x402": "*",
    "@x402/core": "*",
    "@x402/fetch": "*",
    "@noble/ed25519": "*",
    "safe-stable-stringify": "*",
    "viem": "*"
  },
  "devDependencies": { "vitest": "^3", "typescript": "^5" }
}
```

(`apps/server/package.json` analogous: `express`, `cors`, `@x402/express`, `@x402/core`, `@metamask/x402`, `@briefcase/chain": "workspace:*"`, dev: `supertest`, `@types/express`, `@types/supertest`.)

- [ ] **Step 3: Install and pin**

Run: `pnpm install` then `pnpm -r exec tsc --noEmit`
Expected: install succeeds; typecheck passes (no source yet). **Record the resolved versions of `@metamask/x402` and `@metamask/smart-accounts-kit` in README later; convert `*` to exact pins via `pnpm add -E` once resolved.**

- [ ] **Step 4: Smoke-verify critical imports exist before building on them**

```ts
// scripts/verify-sdk-surface.ts — fail fast if research-derived API names drifted
import { toMetaMaskSmartAccount, createDelegation, Implementation, ScopeType } from "@metamask/smart-accounts-kit";
import { erc7715ProviderActions, erc7710WalletActions } from "@metamask/smart-accounts-kit/actions";
import { createx402DelegationProvider } from "@metamask/smart-accounts-kit/experimental";
import { x402Erc7710Client, x402ExactEvmErc7710ServerScheme } from "@metamask/x402";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
console.log("all SDK exports resolved:", [toMetaMaskSmartAccount, createDelegation, Implementation, ScopeType, erc7715ProviderActions, erc7710WalletActions, createx402DelegationProvider, x402Erc7710Client, x402ExactEvmErc7710ServerScheme, x402Client, x402HTTPClient, wrapFetchWithPayment].every(Boolean));
```

Run: `pnpm tsx scripts/verify-sdk-surface.ts`
Expected: `all SDK exports resolved: true`. **If any import fails, STOP — re-read the installed package's actual exports (`node_modules/.../package.json` `exports` field + d.ts) and update plan tasks before proceeding.**

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: pnpm monorepo scaffold with SDK surface verification"
```

---

### Task 2: `packages/chain/src/config.ts` + accounts

**Files:**
- Create: `packages/chain/src/config.ts`, `packages/chain/src/accounts.ts`, `packages/chain/src/index.ts`
- Test: `packages/chain/test/accounts.test.ts`

- [ ] **Step 1: Write config**

```ts
// packages/chain/src/config.ts
import { baseSepolia, base } from "viem/chains";

export const CHAINS = { demo: baseSepolia, settlement: base } as const;

export const ADDRESSES = {
  usdcBaseSepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  usdcBase: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
} as const;

export const FACILITATOR_BASE_SEPOLIA =
  "https://tx-sentinel-base-sepolia.api.cx.metamask.io/platform/v2/x402";
export const ONESHOT_TESTNET = "https://relayer.1shotapi.dev/relayers";
export const ONESHOT_MAINNET = "https://relayer.1shotapi.com/relayers";

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
```

- [ ] **Step 2: Write failing test for account factory**

```ts
// packages/chain/test/accounts.test.ts
import { describe, it, expect } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { makeBuyerSmartAccount } from "../src/accounts.js";
import { CHAINS } from "../src/config.js";

describe("makeBuyerSmartAccount", () => {
  it("derives a deterministic smart-account address from a signer key", async () => {
    const pk = generatePrivateKey();
    const a = await makeBuyerSmartAccount(pk, CHAINS.demo);
    const b = await makeBuyerSmartAccount(pk, CHAINS.demo);
    expect(a.address).toBe(b.address);
    expect(a.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `pnpm --filter @briefcase/chain test` → FAIL (module not found)
- [ ] **Step 4: Implement**

```ts
// packages/chain/src/accounts.ts
import { createPublicClient, http, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { toMetaMaskSmartAccount, Implementation } from "@metamask/smart-accounts-kit";

export function publicClientFor(chain: Chain) {
  return createPublicClient({ chain, transport: http() });
}

/** Counterfactual Hybrid smart account owned by a burner EOA (buyer/specialist wallets). */
export async function makeBuyerSmartAccount(pk: Hex, chain: Chain) {
  const account = privateKeyToAccount(pk);
  return toMetaMaskSmartAccount({
    client: publicClientFor(chain),
    implementation: Implementation.Hybrid,
    deployParams: [account.address, [], [], []],
    deploySalt: "0x",
    signer: { account },
  });
}

/** Stateless 7702 smart account view over an EOA (Chief settlement wallet for 1Shot). */
export async function makeChief7702Account(pk: Hex, chain: Chain) {
  const account = privateKeyToAccount(pk);
  return toMetaMaskSmartAccount({
    client: publicClientFor(chain),
    implementation: Implementation.Stateless7702,
    address: account.address,
    signer: { account },
  });
}
```

```ts
// packages/chain/src/index.ts
export * from "./config.js";
export * from "./accounts.js";
```

- [ ] **Step 5: Run tests** — Expected: PASS (note: `toMetaMaskSmartAccount` may hit the RPC to compute the counterfactual address; if the test is flaky offline, mark it as integration-style and keep it — it validates real SDK behavior)
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(chain): config and smart-account factories"`

---

### Task 3: Delegation slicing (`slicing.ts`) — the A2A core

**Files:**
- Create: `packages/chain/src/slicing.ts`
- Test: `packages/chain/test/slicing.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/chain/test/slicing.test.ts
import { describe, it, expect } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { parseUnits } from "viem";
import { makeBuyerSmartAccount } from "../src/accounts.js";
import { planSlices, buildSliceDelegation } from "../src/slicing.js";
import { CHAINS, ADDRESSES } from "../src/config.js";

describe("planSlices", () => {
  it("rejects slices that sum over the parent budget", () => {
    expect(() =>
      planSlices(parseUnits("10", 6), [
        { name: "scout", amount: parseUnits("6", 6) },
        { name: "analyst", amount: parseUnits("5", 6) },
      ]),
    ).toThrow(/exceeds parent budget/);
  });

  it("accepts slices within budget and assigns unique salts", () => {
    const plan = planSlices(parseUnits("10", 6), [
      { name: "scout", amount: parseUnits("3", 6) },
      { name: "analyst", amount: parseUnits("2", 6) },
    ]);
    expect(plan).toHaveLength(2);
    expect(new Set(plan.map((p) => p.salt)).size).toBe(2);
    plan.forEach((p) => expect(p.salt).toMatch(/^0x[0-9a-f]{64}$/));
  });
});

describe("buildSliceDelegation", () => {
  it("builds an unsigned delegation from chief to a specialist with ERC20 cap", async () => {
    const chief = await makeBuyerSmartAccount(generatePrivateKey(), CHAINS.demo);
    const scout = await makeBuyerSmartAccount(generatePrivateKey(), CHAINS.demo);
    const d = buildSliceDelegation({
      from: chief, toAddress: scout.address,
      tokenAddress: ADDRESSES.usdcBaseSepolia,
      amount: parseUnits("3", 6),
      salt: ("0x" + "11".repeat(32)) as `0x${string}`,
    });
    expect(d.delegator.toLowerCase()).toBe(chief.address.toLowerCase());
    expect(d.delegate.toLowerCase()).toBe(scout.address.toLowerCase());
    expect(d.caveats.length).toBeGreaterThan(0);
    expect(d.signature === undefined || d.signature === "0x").toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `pnpm --filter @briefcase/chain test`
- [ ] **Step 3: Implement**

```ts
// packages/chain/src/slicing.ts
import { randomBytes } from "node:crypto";
import { bytesToHex } from "viem";
import { createDelegation, ScopeType } from "@metamask/smart-accounts-kit";

export interface SliceRequest { name: string; amount: bigint }
export interface SlicePlan extends SliceRequest { salt: `0x${string}` }

/** Validate a budget split and assign fresh random salts (replay protection). */
export function planSlices(parentBudget: bigint, slices: SliceRequest[]): SlicePlan[] {
  const total = slices.reduce((s, x) => s + x.amount, 0n);
  if (total > parentBudget) {
    throw new Error(`slice total ${total} exceeds parent budget ${parentBudget}`);
  }
  return slices.map((s) => ({ ...s, salt: bytesToHex(randomBytes(32)) as `0x${string}` }));
}

interface BuildArgs {
  from: { address: `0x${string}`; environment: unknown };
  toAddress: `0x${string}`;
  tokenAddress: `0x${string}`;
  amount: bigint;
  salt: `0x${string}`;
  /** Signed parent delegation or 7715 permission context — present in production, omitted in unit tests. */
  parentDelegation?: unknown;
  parentPermissionContext?: `0x${string}`;
}

/** Build an (unsigned) ERC20-capped redelegation from Chief to one specialist. */
export function buildSliceDelegation(a: BuildArgs) {
  return createDelegation({
    to: a.toAddress,
    from: a.from.address,
    environment: (a.from as any).environment,
    salt: a.salt,
    scope: { type: ScopeType.Erc20TransferAmount, tokenAddress: a.tokenAddress, maxAmount: a.amount },
    ...(a.parentDelegation ? { parentDelegation: a.parentDelegation } : {}),
    ...(a.parentPermissionContext ? { parentPermissionContext: a.parentPermissionContext } : {}),
  } as Parameters<typeof createDelegation>[0]);
}
```

**Note:** the exact `createDelegation` option names (`parentDelegation`/`parentPermissionContext`) were taken from official docs; the SDK-surface check in Task 1 plus this test catches drift. If the installed SDK differs, adapt here and ONLY here — callers depend on `buildSliceDelegation`, not on the SDK.

- [ ] **Step 4: Run tests** — Expected: PASS
- [ ] **Step 5: Commit** — `git commit -am "feat(chain): A2A delegation slicing with budget validation"`

---

### Task 4: 1Shot relayer client

**Files:**
- Create: `packages/chain/src/oneshot/client.ts`
- Test: `packages/chain/test/oneshot-client.test.ts`

- [ ] **Step 1: Write failing tests (mocked fetch)**

```ts
// packages/chain/test/oneshot-client.test.ts
import { describe, it, expect, vi } from "vitest";
import { OneShotClient } from "../src/oneshot/client.js";

const ok = (result: unknown) => ({
  ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result }),
}) as Response;

describe("OneShotClient", () => {
  it("getCapabilities returns per-chain target and fee collector", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({
      "84532": { targetAddress: "0xT", feeCollector: "0xF", tokens: [{ symbol: "USDC", address: "0xU" }] },
    }));
    const c = new OneShotClient("https://relayer.example/relayers", fetchMock as any);
    const caps = await c.getCapabilities(84532);
    expect(caps.targetAddress).toBe("0xT");
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.method).toBe("relayer_getCapabilities");
  });

  it("throws a typed error on JSON-RPC error responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, error: { code: 4204, message: "Quote Expired" } }),
    } as Response);
    const c = new OneShotClient("https://relayer.example/relayers", fetchMock as any);
    await expect(c.getStatus("0xabc")).rejects.toMatchObject({ code: 4204 });
  });

  it("estimateThenSend re-estimates when fee changes, then sends with price-lock context", async () => {
    const responses = [
      ok({ success: true, requiredPaymentAmount: "20000", gasUsed: "1", context: "ctx1" }), // estimate 1 (fee differs from initial 10000)
      ok({ success: true, requiredPaymentAmount: "20000", gasUsed: "1", context: "ctx2" }), // estimate 2 (after re-sign)
      ok("0x" + "ab".repeat(32)),                                                            // send
    ];
    const fetchMock = vi.fn().mockImplementation(async () => responses.shift());
    const c = new OneShotClient("https://relayer.example/relayers", fetchMock as any);
    const rebuilds: bigint[] = [];
    const taskId = await c.estimateThenSend(
      async (fee) => { rebuilds.push(fee); return { chainId: "84532", transactions: [] } as any; },
      10000n, { destinationUrl: "https://hook.example" },
    );
    expect(rebuilds).toEqual([10000n, 20000n]);  // initial fee, then exact required fee
    expect(taskId).toMatch(/^0x[0-9a-f]{64}$/);
    const sendBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(sendBody.method).toBe("relayer_send7710Transaction");
    expect(sendBody.params.context).toBe("ctx2");
    expect(sendBody.params.destinationUrl).toBe("https://hook.example");
  });
});
```

- [ ] **Step 2: Run to verify FAIL**
- [ ] **Step 3: Implement**

```ts
// packages/chain/src/oneshot/client.ts
export class OneShotRpcError extends Error {
  constructor(public code: number, message: string) { super(message); }
}

export interface OneShotBundle {
  chainId: string;
  transactions: { permissionContext: unknown[]; executions: { target: string; value: string; data: string }[] }[];
  authorizationList?: { address: string; chainId: number; nonce: number; r: string; s: string; yParity: number }[];
}
export interface EstimateResult { success: boolean; requiredPaymentAmount: string; gasUsed: string; context: string }
export interface StatusResult { status: number; hash?: string; receipt?: unknown; data?: string; memo?: string }

export class OneShotClient {
  constructor(private url: string, private fetchImpl: typeof fetch = fetch) {}

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) throw new OneShotRpcError(res.status, `HTTP ${res.status}`);
    const j = await res.json();
    if (j.error) throw new OneShotRpcError(j.error.code, j.error.message);
    return j.result as T;
  }

  async getCapabilities(chainId: number) {
    const r = await this.rpc<Record<string, any>>("relayer_getCapabilities", [String(chainId)]);
    return r[String(chainId)];
  }
  getFeeData(chainId: number, token: string) {
    return this.rpc<{ minFee: string; feeCollector: string; targetAddress: string }>(
      "relayer_getFeeData", { chainId: String(chainId), token });
  }
  estimate(bundle: OneShotBundle) {
    return this.rpc<EstimateResult>("relayer_estimate7710Transaction", bundle);
  }
  send(bundle: OneShotBundle, context: string, opts: { destinationUrl?: string; memo?: string } = {}) {
    return this.rpc<string>("relayer_send7710Transaction", { ...bundle, context, ...opts });
  }
  getStatus(id: string) {
    return this.rpc<StatusResult>("relayer_getStatus", { id, logs: false });
  }

  /**
   * Estimate-first loop: build+sign bundle at a fee, estimate; if the relayer
   * requires a different fee, rebuild ONCE at the exact required fee and re-estimate.
   * Sends with the latest price-lock context (valid ~45s).
   */
  async estimateThenSend(
    buildSigned: (fee: bigint) => Promise<OneShotBundle>,
    initialFee: bigint,
    opts: { destinationUrl?: string; memo?: string } = {},
  ): Promise<string> {
    let bundle = await buildSigned(initialFee);
    let est = await this.estimate(bundle);
    if (BigInt(est.requiredPaymentAmount) !== initialFee) {
      bundle = await buildSigned(BigInt(est.requiredPaymentAmount));
      est = await this.estimate(bundle);
    }
    if (!est.success) throw new OneShotRpcError(4211, "simulation failed");
    return this.send(bundle, est.context, opts);
  }
}
```

- [ ] **Step 4: Run tests** — Expected: PASS
- [ ] **Step 5: Live read-only check against the real testnet relayer**

```ts
// scripts/check-1shot-caps.ts
import { OneShotClient } from "../packages/chain/src/oneshot/client.js";
import { ONESHOT_TESTNET } from "../packages/chain/src/config.js";
const caps = await new OneShotClient(ONESHOT_TESTNET).getCapabilities(84532);
console.log(caps); // expect targetAddress, feeCollector, tokens[] incl. USDC
```

Run: `pnpm tsx scripts/check-1shot-caps.ts`
Expected: real capabilities JSON for Base Sepolia. Record `targetAddress`/`feeCollector` in the spike notes.

- [ ] **Step 6: Commit** — `git commit -am "feat(chain): 1Shot relayer client with estimate-first loop"`

---

### Task 5: 1Shot webhook verification

**Files:**
- Create: `packages/chain/src/oneshot/webhook.ts`
- Test: `packages/chain/test/oneshot-webhook.test.ts`

- [ ] **Step 1: Write failing tests (self-generated Ed25519 fixture)**

```ts
// packages/chain/test/oneshot-webhook.test.ts
import { describe, it, expect } from "vitest";
import * as ed from "@noble/ed25519";
import stringify from "safe-stable-stringify";
import { verifyWebhook, WebhookDeduper } from "../src/oneshot/webhook.js";

async function signedEvent(priv: Uint8Array, overrides: Record<string, unknown> = {}) {
  const event: Record<string, unknown> = {
    apiVersion: 0, type: 0,
    data: { id: "0x" + "11".repeat(32), status: 200, memo: "demo" },
    timestamp: 1760000000, keyId: "0", ...overrides,
  };
  const sig = await ed.signAsync(new TextEncoder().encode(stringify(event)), priv);
  return { ...event, signature: Buffer.from(sig).toString("base64") };
}

describe("verifyWebhook", () => {
  it("accepts a correctly signed event", async () => {
    const priv = ed.utils.randomSecretKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const evt = await signedEvent(priv);
    expect(await verifyWebhook(evt, { "0": pub })).toBe(true);
  });
  it("rejects a tampered event", async () => {
    const priv = ed.utils.randomSecretKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const evt = await signedEvent(priv);
    (evt.data as any).memo = "tampered";
    expect(await verifyWebhook(evt, { "0": pub })).toBe(false);
  });
  it("rejects unknown keyId", async () => {
    const priv = ed.utils.randomSecretKey();
    const evt = await signedEvent(priv, { keyId: "9" });
    expect(await verifyWebhook(evt, {})).toBe(false);
  });
});

describe("WebhookDeduper", () => {
  it("admits an event once per (taskId, type)", () => {
    const d = new WebhookDeduper();
    expect(d.admit("0xaa", 0)).toBe(true);
    expect(d.admit("0xaa", 0)).toBe(false);
    expect(d.admit("0xaa", 4)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**
- [ ] **Step 3: Implement**

```ts
// packages/chain/src/oneshot/webhook.ts
import * as ed from "@noble/ed25519";
import stringify from "safe-stable-stringify";

export interface WebhookEvent {
  apiVersion: number; type: number; data: { id: string; [k: string]: unknown };
  timestamp: number; keyId: string; signature: string;
}

/** Verify an Ed25519-signed 1Shot webhook. Keys map: keyId -> raw public key bytes. */
export async function verifyWebhook(
  event: Record<string, unknown>, keys: Record<string, Uint8Array>,
): Promise<boolean> {
  const { signature, ...rest } = event as WebhookEvent & Record<string, unknown>;
  const pub = keys[String(event.keyId)];
  if (!pub || typeof signature !== "string") return false;
  try {
    return await ed.verifyAsync(
      Uint8Array.from(Buffer.from(signature, "base64")),
      new TextEncoder().encode(stringify(rest)),
      pub,
    );
  } catch { return false; }
}

/** Fetch + cache the relayer JWKS (Ed25519, OKP). */
export async function fetchJwks(baseUrl: string, fetchImpl: typeof fetch = fetch) {
  const origin = new URL(baseUrl).origin;
  const res = await fetchImpl(`${origin}/.well-known/jwks.json`);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const jwks = (await res.json()) as { keys: { kid: string; x: string }[] };
  const map: Record<string, Uint8Array> = {};
  for (const k of jwks.keys) map[k.kid] = Uint8Array.from(Buffer.from(k.x, "base64url"));
  return map;
}

/** At-least-once delivery → dedupe on (taskId, type). */
export class WebhookDeduper {
  private seen = new Set<string>();
  admit(taskId: string, type: number): boolean {
    const key = `${taskId}:${type}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}
```

- [ ] **Step 4: Run tests** — Expected: PASS
- [ ] **Step 5: Commit** — `git commit -am "feat(chain): 1Shot webhook Ed25519 verification and dedupe"`

---

### Task 6: x402-gated intel API (seller)

**Files:**
- Create: `apps/server/src/index.ts`, `apps/server/src/intel.ts`, `apps/server/src/intelData.ts`
- Test: `apps/server/test/intel.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/server/test/intel.test.ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildApp } from "../src/index.js";

describe("intel API payment gate", () => {
  const app = buildApp({ payTo: "0x" + "22".repeat(20) as `0x${string}` });

  it("returns 402 with PAYMENT-REQUIRED header when unpaid", async () => {
    const res = await request(app).get("/api/intel/uniswap");
    expect(res.status).toBe(402);
    const header = res.headers["payment-required"];
    expect(header).toBeDefined();
    const decoded = JSON.parse(Buffer.from(header, "base64").toString());
    expect(decoded.accepts?.length).toBeGreaterThan(0);
    expect(decoded.accepts[0].extra?.assetTransferMethod).toBe("erc7710");
  });

  it("healthz is free", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**
- [ ] **Step 3: Implement**

```ts
// apps/server/src/intelData.ts
/** Curated intel payloads — the "premium data" agents purchase. Deterministic, no external deps. */
export function intelFor(topic: string) {
  return {
    topic,
    generatedAt: new Date().toISOString(),
    headlines: [
      `${topic}: developer activity snapshot`,
      `${topic}: liquidity and listings overview`,
      `${topic}: social sentiment digest`,
    ],
    note: "Premium intel feed (paid via x402 + ERC-7710 delegation)",
  };
}
```

```ts
// apps/server/src/intel.ts
import { Router } from "express";
import { intelFor } from "./intelData.js";

export const intelRouter = Router();
intelRouter.get("/api/intel/:topic", (req, res) => {
  res.json(intelFor(req.params.topic));
});
```

```ts
// apps/server/src/index.ts
import express from "express";
import cors from "cors";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { x402ExactEvmErc7710ServerScheme } from "@metamask/x402";
import { intelRouter } from "./intel.js";

const FACILITATOR = "https://tx-sentinel-base-sepolia.api.cx.metamask.io/platform/v2/x402";

export function buildApp(opts: { payTo: `0x${string}`; facilitatorUrl?: string }) {
  const app = express();
  app.use(cors({ exposedHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE"] }));
  app.get("/healthz", (_req, res) => { res.json({ ok: true }); });

  const facilitator = new HTTPFacilitatorClient({ url: opts.facilitatorUrl ?? FACILITATOR });
  const server = new x402ResourceServer(facilitator)
    .register("eip155:84532", new x402ExactEvmErc7710ServerScheme());

  app.use(paymentMiddleware(
    {
      "GET /api/intel/:topic": {
        accepts: [{
          scheme: "exact", price: "$0.01", network: "eip155:84532",
          payTo: opts.payTo, extra: { assetTransferMethod: "erc7710" },
        }],
        description: "Premium intel feed", mimeType: "application/json",
      },
    },
    server,
  ));
  app.use(intelRouter);
  return app;
}

// boot only when run directly
if (process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js")) {
  const payTo = process.env.SERVER_PAYTO as `0x${string}`;
  if (!payTo) throw new Error("SERVER_PAYTO required");
  buildApp({ payTo }).listen(4021, () => console.log("intel API on :4021"));
}
```

**Note:** exact `paymentMiddleware`/route-pattern API shape must be validated against the installed `@x402/express` version (Task 1 Step 4 catches import-level drift; this task's test catches behavior drift, e.g. header name `PAYMENT-REQUIRED` vs `X-PAYMENT`). If the installed version emits the v1 header, adapt the test to whatever the real SDK does and record it — the buyer SDK from the same version family will match.

- [ ] **Step 4: Run tests** — Expected: PASS (the 402 challenge is generated locally; no facilitator call needed until settlement)
- [ ] **Step 5: Commit** — `git commit -am "feat(server): x402-gated intel API with ERC-7710 scheme"`

---

### Task 7: x402 buyer client (`paidFetch.ts`)

**Files:**
- Create: `packages/chain/src/paidFetch.ts`
- Test: `packages/chain/test/paidFetch.test.ts`

- [ ] **Step 1: Write failing test (construction-level; the real 402 round-trip is the Task 8 spike)**

```ts
// packages/chain/test/paidFetch.test.ts
import { describe, it, expect } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { makeBuyerSmartAccount } from "../src/accounts.js";
import { makePaidFetch } from "../src/paidFetch.js";
import { CHAINS } from "../src/config.js";

describe("makePaidFetch", () => {
  it("returns a fetch-compatible function and passes through non-402 responses", async () => {
    const account = await makeBuyerSmartAccount(generatePrivateKey(), CHAINS.demo);
    const inner = async () => new Response(JSON.stringify({ free: true }), { status: 200 });
    const paidFetch = makePaidFetch({ account, fetchImpl: inner as typeof fetch });
    const res = await paidFetch("https://example.com/free");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ free: true });
  });
});
```

- [ ] **Step 2: Run to verify FAIL**
- [ ] **Step 3: Implement**

```ts
// packages/chain/src/paidFetch.ts
import { createx402DelegationProvider } from "@metamask/smart-accounts-kit/experimental";
import { x402Erc7710Client } from "@metamask/x402";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";

export interface PaidFetchOptions {
  /** The paying smart account (buyer) — or session account when redelegating a 7715 grant. */
  account: unknown;
  /** Present when the agent spends a user's 7715 grant rather than its own funds. */
  parentPermissionContext?: `0x${string}`;
  /** The user's account address when redelegating (matches the 7715 grant's `from`). */
  from?: `0x${string}`;
  fetchImpl?: typeof fetch;
}

/** HTTP client that auto-pays x402 challenges with an ERC-7710 delegation. */
export function makePaidFetch(opts: PaidFetchOptions): typeof fetch {
  const delegationProvider = createx402DelegationProvider({
    account: opts.account as never,
    ...(opts.parentPermissionContext
      ? { parentPermissionContext: opts.parentPermissionContext, from: opts.from }
      : {}),
  } as never);
  const erc7710 = new x402Erc7710Client({ delegationProvider });
  const core = new x402Client().register("eip155:*", erc7710);
  return wrapFetchWithPayment(opts.fetchImpl ?? fetch, new x402HTTPClient(core));
}
```

- [ ] **Step 4: Run tests** — Expected: PASS
- [ ] **Step 5: Commit** — `git commit -am "feat(chain): x402 buyer client paying via 7710 delegations"`

---

### Task 8: LIVE SPIKE — full x402 + 7710 round-trip on Base Sepolia

**Files:**
- Create: `scripts/spike-x402-roundtrip.ts`, `docs/superpowers/spikes/2026-06-XX-x402-roundtrip.md` (results)

This validates the project's riskiest assumption. Requires Task 0 funding complete.

- [ ] **Step 1: Write the spike script**

```ts
// scripts/spike-x402-roundtrip.ts
// Buyer smart account (funded with Base Sepolia USDC) pays our local intel API
// through the tx-sentinel facilitator. Run server first: SERVER_PAYTO=<chief addr> pnpm tsx apps/server/src/index.ts
import "dotenv/config";
import { makeBuyerSmartAccount } from "../packages/chain/src/accounts.js";
import { makePaidFetch } from "../packages/chain/src/paidFetch.js";
import { CHAINS, requireEnv } from "../packages/chain/src/config.js";

const account = await makeBuyerSmartAccount(requireEnv("DEV_BUYER_PK") as `0x${string}`, CHAINS.demo);
console.log("buyer smart account:", account.address, "(fund this address with USDC!)");
const paidFetch = makePaidFetch({ account });

const res = await paidFetch("http://localhost:4021/api/intel/uniswap");
console.log("status:", res.status);
console.log("payment-response header:", res.headers.get("PAYMENT-RESPONSE"));
console.log("body:", await res.json());
```

- [ ] **Step 2: Start server, run spike**

Run: `pnpm tsx scripts/spike-x402-roundtrip.ts`
Expected: `status: 200`, a `PAYMENT-RESPONSE` header containing a settlement receipt/tx hash, and the intel JSON body. On-chain: USDC moved from buyer smart account to `SERVER_PAYTO` on Base Sepolia (verify on sepolia.basescan.org).

- [ ] **Step 3: Record results in `docs/superpowers/spikes/`** — actual header names, facilitator behavior, tx hash, any API drift discovered and how it was resolved. **This document feeds Plan 2.**
- [ ] **Step 4: Commit** — `git add -A && git commit -m "test: live x402+7710 round-trip spike on Base Sepolia"`

---

### Task 9: LIVE SPIKE — 1Shot relay with 7702 upgrade (Sepolia testnet relayer)

**Files:**
- Create: `scripts/spike-1shot-relay.ts`, results appended to spike notes

- [ ] **Step 1: Write the spike script**

```ts
// scripts/spike-1shot-relay.ts
// Chief EOA: 7702-upgrade + relay a 7710 bundle paying the fee in USDC on Base Sepolia.
import "dotenv/config";
import { createPublicClient, http, encodeFunctionData, erc20Abi, getAddress, bytesToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "node:crypto";
import { createDelegation, ScopeType } from "@metamask/smart-accounts-kit";
import { makeChief7702Account } from "../packages/chain/src/accounts.js";
import { OneShotClient } from "../packages/chain/src/oneshot/client.js";
import { CHAINS, ONESHOT_TESTNET, requireEnv } from "../packages/chain/src/config.js";

const chain = CHAINS.demo;
const pk = requireEnv("DEV_CHIEF_PK") as `0x${string}`;
const eoa = privateKeyToAccount(pk);
const publicClient = createPublicClient({ chain, transport: http() });
const oneshot = new OneShotClient(ONESHOT_TESTNET);

const caps = await oneshot.getCapabilities(chain.id);
const usdc = caps.tokens.find((t: any) => t.symbol === "USDC");
console.log("relayer target:", caps.targetAddress, "feeCollector:", caps.feeCollector, "usdc:", usdc.address);

const chief = await makeChief7702Account(pk, chain);

// 7702 authorization (only needed while the EOA is not yet upgraded)
const code = await publicClient.getCode({ address: eoa.address });
let authorizationList: any[] | undefined;
if (!code || code === "0x") {
  const nonce = await publicClient.getTransactionCount({ address: eoa.address, blockTag: "pending" });
  const auth = await eoa.signAuthorization({
    chainId: chain.id,
    contractAddress: getAddress((chief as any).environment.implementations.EIP7702StatelessDeleGatorImpl),
    nonce,
  });
  authorizationList = [{ address: auth.address, chainId: auth.chainId, nonce: auth.nonce, r: auth.r, s: auth.s, yParity: auth.yParity ?? 0 }];
  console.log("attaching 7702 authorization");
}

const PAYOUT = 10000n; // 0.01 USDC demo payout to self
async function buildSigned(fee: bigint) {
  const delegation = createDelegation({
    to: caps.targetAddress, from: chief.address, environment: chief.environment,
    salt: bytesToHex(randomBytes(32)) as `0x${string}`,
    scope: { type: ScopeType.Erc20TransferAmount, tokenAddress: usdc.address, maxAmount: fee + PAYOUT },
  });
  const signature = await chief.signDelegation({ delegation });
  return {
    chainId: String(chain.id),
    ...(authorizationList ? { authorizationList } : {}),
    transactions: [{
      permissionContext: [{ ...delegation, signature }],
      executions: [
        { target: usdc.address, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [caps.feeCollector, fee] }) },
        { target: usdc.address, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [eoa.address, PAYOUT] }) },
      ],
    }],
  };
}

const fee = await oneshot.getFeeData(chain.id, usdc.address);
const taskId = await oneshot.estimateThenSend(buildSigned as any, BigInt(fee.minFee), { memo: "briefcase-spike" });
console.log("taskId:", taskId);
for (;;) {
  const s = await oneshot.getStatus(taskId);
  console.log("status:", s.status, s.hash ?? "");
  if (s.status >= 200) { console.log(JSON.stringify(s, null, 2)); break; }
  await new Promise((r) => setTimeout(r, 3000));
}
```

- [ ] **Step 2: Fund Chief address with Base Sepolia USDC (≥1 USDC; NO ETH needed — that's the point), run spike**

Run: `pnpm tsx scripts/spike-1shot-relay.ts`
Expected: prints capabilities, attaches 7702 auth, taskId returned, status progresses 100 → 110 (hash) → 200 (receipt). Afterward `getCode(eoa)` returns `0xef0100…` (upgraded). Fee paid in USDC visible on basescan.

- [ ] **Step 3: Record results in spike notes; note exact JSON field-name reality vs plan**
- [ ] **Step 4: Commit** — `git add -A && git commit -m "test: live 1Shot 7702+7710 relay spike on Base Sepolia"`

---

### Task 10: Plan-1 wrap-up gate

- [ ] **Step 1: Full check** — Run: `pnpm -r test && pnpm typecheck` → all green
- [ ] **Step 2: Update README stub with verified versions + spike results summary**
- [ ] **Step 3: Commit** — `git commit -am "chore: plan 1 complete — payment rails verified live"`
- [ ] **Step 4: Write Plan 2 (agents + orchestrator) and Plan 3 (web UI + demo) informed by spike findings**

---

## Self-Review Notes

- **Spec coverage:** Plan 1 covers spec §4 `packages/chain` + server seller portion of §5(3), §5(6), §6 (payment error handling), §7 unit/integration. Agents (§5(4)), SSE/UI, Venice, 7715 browser flow, settlement service, demo assets → Plans 2–3 by design.
- **Placeholders:** none; every step has code or exact commands.
- **Type consistency:** `OneShotClient.estimateThenSend(buildSigned, initialFee, opts)` matches Task 9 usage; `makePaidFetch({account, parentPermissionContext, from})` matches spec §5(3); `buildSliceDelegation` consumed in Plan 2.
- **Known uncertainty (explicit, not placeholder):** experimental SDK surfaces (`@metamask/x402@0.2.x`, `/experimental`) may drift from research; Task 1 Step 4 fails fast, Tasks 6–9 record actual behavior in spike notes that feed Plans 2–3. Adaptation happens inside `packages/chain` only.
