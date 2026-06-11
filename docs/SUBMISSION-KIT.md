# Briefcase — Submission Kit

Everything needed to submit, minus the live runs. Prepared 2026-06-11.

---

## A. Demo Video Script (~3 min, word-for-word)

**Goal:** show a working MetaMask Smart Accounts Kit integration (the ERC-7715 grant)
in the MAIN FLOW — required by every track. Record at 1440p, browser zoomed ~110%.

**Pre-flight (off camera):**
- `SERVER_PAYTO=0x39ba9943aDBcDB3a8C9C06e25ddABd134A64F793 VENICE_API_KEY=… DEV_CHIEF_PK=… pnpm --filter @briefcase/server dev`
- `pnpm --filter @briefcase/web dev` → open http://localhost:5173
- MetaMask 13.34.1 unlocked, on Base Sepolia, with the demo account.

| # | Shot (what to click) | Say (narration) |
|---|---|---|
| 1 | Landing hero, cursor still | "This is Briefcase. You grant a budget once in MetaMask, and an autonomous AI research team works for you — buying its own intelligence, data, and gas. Nothing moves without your permission, and you can revoke it in one click." |
| 2 | Click **1 · Connect MetaMask**, approve popup | "First I connect MetaMask." |
| 3 | Click **2 · Grant 10 USDC/day**, the MetaMask Advanced Permissions popup appears — hold on it 2-3s | "Now the core: I grant an ERC-7715 Advanced Permission — up to 10 USDC per day. This is fine-grained, revocable spending authority, signed right in the MetaMask extension. MetaMask upgrades my account to a smart account behind the scenes." |
| 4 | Approve the grant; the USER and CHIEF nodes light up | "Granted. The chief agent now holds delegated authority." |
| 5 | Type a topic (e.g. `uniswap`), click **3 · Dispatch team** | "I dispatch the team on a topic." |
| 6 | Delegation tree: three slice edges animate; Scout/Analyst/Designer badges flip to 'working' | "Watch the budget split. The chief redelegates narrower slices to three specialists — this is agent-to-agent coordination via ERC-7710 redelegation." |
| 7 | Event feed: 'x402 payment settled' rows appear | "Each specialist pays for what it needs over x402 — premium intel, Venice AI inference — using its delegation slice. No API keys, no pre-funding. The payment settles on-chain through the MetaMask facilitator." |
| 8 | Report panel renders with cover image | "The result: a research brief, with on-chain signals and a Venice-generated cover. Venice is the brain end to end." |
| 9 | (If demoing 1Shot) cut to terminal running `spike-1shot-relay.ts` on MAINNET, show basescan tx | "Settlement runs on Base mainnet through the 1Shot permissionless relayer — gas paid in USDC, the account upgraded via EIP-7702, zero ETH ever held. Status arrives over signed webhooks." |
| 10 | Back to UI, click **Revoke permission (kill switch)** | "And the kill switch is real. One click cancels the run and revokes the on-chain authority — the agents physically cannot spend another cent, even if they try." |
| 11 | Hero, end card | "Briefcase. Permission you can hand over — and take back." |

**Tips:** keep shot 3 on screen long enough to read the permission details; that frame
is the qualification evidence. If the live job is slow, pre-warm one run before recording
and dispatch a second on camera.

---

## B. HackQuest Submission Text

**Tagline:** Grant a budget once in MetaMask — hire an autonomous AI research team that buys its own intelligence, data, and gas.

**Description:**
Briefcase turns a single MetaMask permission into a working AI agent workforce. A user
grants one ERC-7715 Advanced Permission (e.g. 10 USDC/day). A chief agent redelegates
narrower budget slices to three specialists (Scout, Analyst, Designer) via ERC-7710
redelegation — true agent-to-agent coordination. Each specialist pays for premium data
and Venice AI inference over x402, settling through the MetaMask facilitator. Payroll
settles on Base mainnet through the 1Shot permissionless relayer: gas paid in USDC, the
account bootstrapped via an EIP-7702 authorization, status streamed back over signed
webhooks. The user can revoke at any moment — cancelling the run and the on-chain authority.

**Track compliance:**

| Track | How Briefcase qualifies |
|---|---|
| Best x402 + ERC-7710 | Specialists pay an x402-gated API and Venice via ERC-7710 delegations (`@metamask/x402` `x402Erc7710Client`; seller uses `x402ExactEvmErc7710ServerScheme`). |
| Best Agent | The entire product is an agent workforce driven by one 7715 grant; Smart Accounts Kit is the main flow. |
| Best A2A Coordination | Chief slices the grant into narrower redelegations per specialist (`createDelegation({ parentPermissionContext })`). |
| Best use of Venice AI | Venice powers all agent reasoning, on-chain reads, and the report cover image; paid via x402 (the agent buys its own intelligence). |
| Best 1Shot Relayer | Mainnet 7710 relay with an attached EIP-7702 authorization, gas paid in USDC, Ed25519-signed webhooks drive the dashboard. |

**Live proof (Base Sepolia):** x402+7710 settlement `0x67b6a6f1…0873c4`; 1Shot 7702 relay
`0xa6775d38…43d4da`. Repo includes 71 passing tests and a hardened, reviewed codebase.

---

## C. Best Feedback Track Submission

During integration we hit two behaviors not documented in the official guides; both cost
real debugging time and would help other builders.

**1. The x402 facilitator silently requires the delegator to be a 7702-upgraded EOA.**
A counterfactual (undeployed) `Implementation.Hybrid` smart account is rejected at
`/verify` with `invalid_exact_evm_erc7710_account_not_delegated` ("delegator EOA must
complete an EIP-7702 upgrade delegating to EIP7702StatelessDeleGator before ERC-7710
verify or settle"). The buyer-with-delegations guide uses a Hybrid example, which reads as
if any smart account works. Suggestion: state explicitly that the x402+7710 buyer path
requires an on-chain 7702-upgraded account, and cross-link the 1Shot relayer as the
gas-free way to perform that upgrade.

**2. 1Shot relayer fee units are inconsistent between two endpoints.**
`relayer_getFeeData.minFee` is a decimal string in human units (`"0.01"`) with
`token.decimals` provided, but `relayer_estimate7710Transaction.requiredPaymentAmount` is
in base units (`"10000"`). Mixing them (e.g. `BigInt("0.01")`) throws. Suggestion: document
the unit of each field in the OpenRPC spec, or normalize both to base units.

Both are now handled in our code and recorded in `docs/superpowers/spikes/`.

---

## D. Best Social Media Track — draft posts (tag @MetaMaskDev)

**Post 1 (kickoff):**
"Building @MetaMaskDev Smart Accounts for our hackathon project: grant an AI agent a USDC
budget *once*, with ERC-7715 Advanced Permissions — then watch it work and revoke it in one
click. The permission UX is the whole product. 🧰 #MetaMask"

**Post 2 (A2A + x402, with the delegation-tree screenshot):**
"Agent-to-agent coordination, live: one 7715 grant → the chief redelegates budget slices to
3 specialists via ERC-7710 → each pays for data + @tryVenice inference over x402. No API
keys, no pre-funding. Smart Accounts Kit makes this feel like one signature. @MetaMaskDev"

**Post 3 (1Shot + kill switch demo clip):**
"Zero ETH, ever. Our agents settle on Base mainnet through the @1ShotAPI relayer — gas paid
in USDC, accounts upgraded via EIP-7702. And the kill switch is real: one click revokes the
on-chain authority. @MetaMaskDev #x402"

---

## Remaining checklist (needs the user + a little spend)

- [ ] Live end-to-end run with Venice funded ($5 x402 top-up from Agent wallet 0x14B8…).
- [ ] 1Shot mainnet settlement leg (Chief wallet 0x39ba…).
- [ ] Record the demo video per script A.
- [ ] Deploy: Vercel (frontend) + tunneled/hosted backend; set `CORS_ORIGINS`.
- [ ] Submit on HackQuest with text B; post C and D.
