# Briefcase

**Grant a budget once in MetaMask — hire an autonomous AI research team that buys its own intelligence, data, and gas.**

Built for the MetaMask Smart Accounts Kit × 1Shot API Hackathon (2026).

## How it works

1. **One permission grant (ERC-7715):** the user approves a capped, revocable budget in the MetaMask extension (e.g. 10 USDC/day).
2. **Agent-to-agent redelegation (ERC-7710):** the Chief agent slices that budget into narrower delegations for specialist agents (Scout / Analyst / Designer).
3. **Agents buy what they need (x402):** specialists auto-pay HTTP 402 challenges with their delegation slice — premium data APIs, Venice AI inference, on-chain reads.
4. **Zero-ETH settlement (1Shot):** payroll settles through the 1Shot Permissionless Relayer — EIP-7702 account upgrades and gas paid in USDC, status streamed back via Ed25519-signed webhooks.
5. **Kill switch:** the user revokes the permission at any time; agents instantly lose spending power.

## Track compliance map

| Track requirement | Where |
|---|---|
| x402 calls via ERC-7710 delegations | `packages/chain/src/paidFetch.ts` (buyer), `apps/server/src/index.ts` (seller, `x402ExactEvmErc7710ServerScheme`) |
| Smart Accounts Kit in main flow | `packages/chain/src/accounts.ts` (7702 smart accounts), 7715 grant in web app |
| Redelegation (A2A) | `packages/chain/src/slicing.ts` |
| Venice AI as core | `packages/agents` (all agent reasoning, image gen, TTS) |
| 1Shot: mainnet 7710 relay + 7702 upgrades + webhooks | `packages/chain/src/oneshot/` (client, Ed25519 webhook verify), `scripts/spike-1shot-relay.ts` |

## Verified live (Base Sepolia, 2026-06-10)

- x402 + ERC-7710 round-trip through the MetaMask tx-sentinel facilitator:
  settlement tx [`0x67b6…73c4`](https://sepolia.basescan.org/tx/0x67b6a6f1f42dfc8e999c751e4b4a33cd8c7752ac34c9d2aa107ac1dffb0873c4)
- 1Shot relay with attached EIP-7702 authorization, gas paid in USDC (zero ETH ever):
  [`0xa677…d4da`](https://sepolia.basescan.org/tx/0xa6775d3879565846e34d8686393b0e5b8a4300dbd80f34da03cbb2360c43d4da)

See `docs/superpowers/spikes/2026-06-10-live-spikes.md` for findings (including two
undocumented SDK/API behaviors discovered and handled).

## Stack

pnpm monorepo · TypeScript · viem · `@metamask/smart-accounts-kit` 1.6.0 ·
`@metamask/x402` 0.2.0 · `@x402/*` 2.14.0 · Express · Venice AI · 1Shot Public Relayer

## Development

```bash
pnpm install
pnpm exec tsx scripts/gen-dev-keys.ts   # creates .env with burner keys
pnpm -r test && pnpm typecheck
SERVER_PAYTO=0x... pnpm --filter @briefcase/server dev
```
