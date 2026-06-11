# Briefcase — Design Spec

**Date:** 2026-06-10
**Event:** MetaMask Smart Accounts Kit × 1Shot API Hackathon (submission deadline 2026-06-15 06:59)
**One-liner:** Grant a budget once in MetaMask — hire an autonomous AI research team that buys its own intelligence, data, and gas.

## 1. Goal & Prize-Track Mapping

One application that qualifies for all five prize tracks:

| Track | Hard requirement | Where Briefcase satisfies it |
|---|---|---|
| Best x402 + ERC-7710 ($3k) | x402 calls paid via ERC-7710 delegations | Agents pay our x402-gated data API and Venice via `x402Erc7710Client` + delegation chains derived from the user's 7715 grant |
| Best Agent ($3k) | Smart Accounts Kit in the main flow | The entire product is an agent workforce driven by one 7715 permission grant |
| Best A2A Coordination ($3k) | Redelegation | Chief agent slices the granted permission into narrower redelegations for 3 specialist agents (`createDelegation({ parentPermissionContext })`) |
| Best use of Venice AI ($3k) | Venice as core, meaningful AI output, must qualify for a main track | Venice powers all agent reasoning (chat + tools), web search, crypto RPC reads, report cover image, TTS summary; Venice is paid via x402 (agent buys its own intelligence) |
| Best 1Shot Relayer ($1k) | Mainnet 7710 relay; 7702 upgrade via relayer; webhooks score higher | Payroll settlement on Base mainnet: 7702 authorization attached to relayed bundle, gas paid in USDC, Ed25519-signed webhooks drive the dashboard |

Demo video must show the Smart Accounts Kit integration (MetaMask popup permission grant) in the **main flow** — it is the opening act of the demo.

## 2. Product Definition

- User connects MetaMask (extension ≥ 13.23) and grants **one** ERC-7715 Advanced Permission: `erc20-token-periodic`, e.g. 10 USDC/day for 7 days, with a human-readable justification. MetaMask upgrades the user's EOA to a smart account (EIP-7702) as part of the grant UX.
- User submits a research task (e.g. "Is token $XYZ worth watching?").
- **Chief agent** plans the job and redelegates narrower budget slices to three specialists:
  - **Scout** (intelligence): Venice chat with web search; buys premium intel from our own x402-gated API.
  - **Analyst** (on-chain): reads chain data via Venice crypto RPC; computes holder/liquidity/activity signals.
  - **Designer** (visuals): Venice image generation for the report cover; chart data prepared for frontend rendering.
- Output: a structured research report rendered in the dashboard + a ~30s Venice TTS audio summary.
- **Settlement:** Chief's mainnet wallet signs a 7710 delegation to 1Shot's relayer `targetAddress` and relays a bundle: [USDC fee transfer to relayer feeCollector, USDC "payroll" transfers to specialist addresses]. First run attaches an EIP-7702 `authorizationList` entry so the relayer upgrades the EOA to `EIP7702StatelessDeleGator`. Status flows back via Ed25519-signed webhooks.
- **Kill switch:** user can revoke the permission at any time (`disableDelegation` / extension revocation); UI demonstrates agents can no longer spend.
- **Delegation tree** is the hero UI: live visualization of permission/budget flowing user → Chief → specialists → x402 payments/settlements, every edge linked to on-chain or HTTP evidence.

## 3. Network Strategy (dual-network)

| Flow | Network | Rationale |
|---|---|---|
| 7715 grant, redelegations, x402 data-API payments | Base Sepolia (`eip155:84532`) | MetaMask tx-sentinel facilitator has a Base Sepolia endpoint; free to rehearse; main tracks have no mainnet requirement |
| Venice x402 top-up | Base mainnet (`eip155:8453`) | Venice only accepts mainnet USDC ($5 minimum top-up) |
| 1Shot settlement (7702 + USDC gas + webhooks) | Base mainnet | Track mandates mainnet relaying |

Total real spend: ~$8–12 USDC. During implementation we probe `getSupportedExecutionPermissions()` on Base mainnet; if 7715 is supported there, optionally promote the main flow to mainnet. Either configuration is compliant.

## 4. Architecture

pnpm monorepo, TypeScript everywhere:

```
briefcase/
├── apps/web        Next.js dashboard: wallet connect, 7715 grant, task submission,
│                   live delegation-tree visualization, report rendering, tx status feed
├── apps/server    Node backend (Hono or Express):
│                   ① agent orchestrator (job queue, agent loop runner)
│                   ② x402-gated intel API (@x402/express paymentMiddleware +
│                      x402ExactEvmErc7710ServerScheme + tx-sentinel facilitator)
│                   ③ 1Shot webhook receiver (Ed25519 verify via JWKS, dedupe)
│                   ④ SSE event stream to frontend
├── packages/agents Chief / Scout / Analyst / Designer — Venice chat-completions
│                   agent loops with tool calling
└── packages/chain  Smart Accounts Kit wrappers: session accounts, redelegation,
                    x402 buyer clients, 1Shot relayer JSON-RPC client
```

Key dependencies: `@metamask/smart-accounts-kit` (+ `/actions`, `/experimental`), `@metamask/x402`, `@x402/core` `@x402/express` `@x402/fetch`, `viem`, Venice API (OpenAI-compatible), 1Shot public relayer (plain JSON-RPC, no key). Official vendor skills (1Shot `public-relayer`, `veniceai/skills`) installed into the dev environment.

## 5. Data Flow (one task lifecycle)

1. **Grant:** `walletClient.extend(erc7715ProviderActions()).requestExecutionPermissions([...])` → MetaMask popup → `{ context: permissionContext, delegationManager, accountMeta }` persisted server-side (session-scoped).
2. **Slice:** Chief creates three redelegations via `createDelegation({ parentPermissionContext, scope, caveats })` — each with smaller `maxAmount`, `limitedCalls`, `timestamp` expiry. Signed by Chief's session smart account.
3. **Procure:** each specialist's HTTP client = `wrapFetchWithPayment(fetch, x402HTTPClient)` with `x402Erc7710Client({ delegationProvider: createx402DelegationProvider({ account, parentPermissionContext, from }) })`. 402 challenges auto-paid within caveat limits; facilitator (tx-sentinel) simulates `redeemDelegations` then settles.
4. **Reason:** agent loops call Venice `POST /chat/completions` (model via `/models/traits` `function_calling_default`) with tools: `x402_fetch`, `venice_crypto_rpc`, `web_search` (server-side tool), `generate_image`. Spend caps enforced at caveat level *and* mirrored in code (step limit, budget meter, timeout breaker).
5. **Compile:** Chief assembles a structured report (markdown + chart payloads + cover image URL + TTS audio); SSE streams progress events that animate the delegation tree.
6. **Settle:** estimate-first loop against 1Shot (`relayer_getFeeData` → build & sign bundle with fresh 32-byte salt → `relayer_estimate7710Transaction` → re-sign if `requiredPaymentAmount` differs → `relayer_send7710Transaction` with ~45s price-lock `context`, `destinationUrl` webhook, `memo`). First run per chain includes one `authorizationList` entry (7702). Webhook types 4/0/1 (submitted/confirmed/reverted) update UI; polling `relayer_getStatus` is the fallback.
7. **Revoke:** kill switch disables the delegation; a deliberately attempted post-revocation spend fails on camera.

## 6. Error Handling

- **x402:** SDK handles 402 retry; payment failures surface as per-agent "procurement failed" report sections, never a silent crash.
- **1Shot:** error-code map (4200–4214) → human-readable UI states; quote-expiry (4204) triggers automatic re-estimate; webhook signatures verified against JWKS with stable-stringify, deduped on `(taskId, type)`; at-least-once delivery assumed.
- **Agents:** hard budget cap (caveat-enforced), max steps, per-call timeout; any specialist failure degrades to a partial report with an explicit failure note.
- **Wallet/UX:** unsupported MetaMask version detected up front with guidance; chain-mismatch prompts; all spends listed with evidence links (tx hash or HTTP receipt).

## 7. Testing

- **Unit:** delegation/caveat construction (slices never exceed parent; salts unique; expiries ordered), fee math, webhook signature verification, report compiler.
- **Integration (Base Sepolia):** real 402 round-trip against our own intel API via tx-sentinel facilitator; redelegation redemption path.
- **E2E:** scripted happy path (grant → task → report → settle) used as the demo dry-run; revocation path.
- **Visual:** dashboard checked at 320/768/1440; reduced-motion respected for tree animations.
- Mainnet steps rehearsed once before recording; demo dry-run checklist is a deliverable.

## 8. Deliverables (by 2026-06-15 06:59)

1. Public GitHub repo; README contains a track-requirement ↔ code-location compliance table.
2. ~3 min demo video (user records per word-for-word script; Venice TTS English voice-over + subtitles): grant popup → delegation tree lights up → report → mainnet settlement with block-explorer proof → kill switch.
3. Hosted live demo (Vercel frontend + hosted backend).
4. HackQuest submission copy (written by us, submitted by user).
5. Optional: 3–4 build-in-public posts on X tagging @MetaMaskDev (social bonus track).

## 9. Out of Scope (YAGNI)

- No database (in-memory + JSON persistence), no auth system beyond wallet session, no multi-user tenancy, no token launch, no mobile app, no agent marketplace UI. Three fixed specialists; no dynamic agent spawning.

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `@metamask/x402@0.2.0` / `/experimental` API drift | Pin exact versions on day 1; vendor a thin adapter layer in `packages/chain` |
| 7715 requires MetaMask ≥ 13.23 on user's machine | Verify user's extension version on day 1 (before building demo around it) |
| tx-sentinel facilitator availability | Sepolia rehearsals early; fallback = run main flow pure-7710 (smart-account-to-smart-account delegation without extension) while keeping the 7715 grant on video |
| Mainnet settlement surprises | Rehearse once with minimal amounts before recording; estimate-first loop; webhook + polling dual path |
| 4.5-day clock | Build order: chain plumbing → x402 loop → agents → UI polish; demo-critical path first, settlement and TTS are independently demoable modules |
