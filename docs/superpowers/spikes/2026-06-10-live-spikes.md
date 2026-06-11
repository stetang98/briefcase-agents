# Live Spike Results — Base Sepolia (2026-06-10/11)

Both Plan-1 spikes succeeded. Findings below feed Plans 2–3.

## Spike A: x402 + ERC-7710 round-trip (Task 8) ✅

Buyer agent auto-paid a 402 challenge from our intel API via ERC-7710 delegation,
settled by the MetaMask tx-sentinel facilitator (Base Sepolia).

- Final: HTTP 200, `PAYMENT-RESPONSE` = `{success:true, payer:0x14b8…a28b, transaction:0x67b6a6f1f42dfc8e999c751e4b4a33cd8c7752ac34c9d2aa107ac1dffb0873c4, network:eip155:84532, amount:"10000"}`
- Server challenge (v2): header `PAYMENT-REQUIRED`, accepts[0].extra includes
  `assetTransferMethod: "erc7710"` AND `facilitatorAddresses: [0xB01c…, 0xB42F…, 0xC066…]`
  (auto-added by `x402ExactEvmErc7710ServerScheme`).
- DelegationManager: `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3`.

### Critical finding 1: delegator MUST be a 7702-upgraded EOA

A counterfactual (undeployed) `Implementation.Hybrid` smart account is REJECTED by
the facilitator at /verify:

```
invalid_exact_evm_erc7710_account_not_delegated
"delegator EOA must complete an EIP-7702 upgrade delegating to EIP7702StatelessDeleGator
 before ERC-7710 verify or settle"
```

→ ALL wallets in Briefcase use `Implementation.Stateless7702` over an EOA, upgraded
on-chain via the 1Shot relayer (zero ETH). `make7702SmartAccount()` is the only
account factory used in production paths. The docs' Hybrid example assumes a
deployed account; counterfactual ≠ deployed.

### Stranded funds note

First faucet send (20 USDC) went to the now-unused counterfactual Hybrid address
`0x27F270ca34f212C76E9aE093a8199baC9123ea46`. Testnet-only loss; ignored.

## Spike B: 1Shot relay + EIP-7702 upgrade (Task 9) ✅

Chief EOA (zero ETH, USDC only) self-upgraded via attached 7702 authorization and
relayed a 2-execution USDC bundle (fee + 8 USDC payout to buyer EOA):

- taskId `0x53118b3f…72ad` → status 100 → 110 → 200
- receipt: block 42690672, tx `0xa6775d3879565846e34d8686393b0e5b8a4300dbd80f34da03cbb2360c43d4da`, gasUsed 326751
- After: `getCode(chief) = 0xef0100 + 63c0c19a…` (EIP7702StatelessDeleGatorImpl)
- Buyer EOA upgraded the same way: taskId `0x45dca807…d4de`, confirmed.

### Critical finding 2: 1Shot fee units are inconsistent

- `relayer_getFeeData.minFee` = DECIMAL string in human units (`"0.01"`), with `token.decimals`.
- `relayer_estimate7710Transaction.requiredPaymentAmount` = BASE units (`"10000"`).

→ Convert minFee with `parseUnits(minFee, feeData.token.decimals)`; treat
requiredPaymentAmount with plain `BigInt`. `OneShotClient.estimateThenSend` takes an
optional `parseFee` for deviating networks; default `BigInt` matches live behavior.

### Other live facts

- Testnet relayer `https://relayer.1shotapi.dev/relayers`: no auth, Base Sepolia caps:
  target `0xf1ef956eff4181Ce913b664713515996858B9Ca9`, feeCollector `0xE936e8FAf4A5655469182A49a505055B71C17604`, USDC only.
- JWKS live at `/.well-known/jwks.json`: single Ed25519 key, kid "0" (matches webhook verifier).
- Estimate gasUsed ~308k for upgrade+2 transfers; fee stayed at minFee (0.01 USDC).
- `estimate` response also contains `paymentTokenAddress`, `paymentChain`, `gasUsed` (per-chain map), `contextByChainId`.

## Implications for Plan 2/3

1. Account bootstrap flow = 1Shot 7702 upgrade (it IS the demo's "agent born with zero ETH" moment).
2. Buyer-side x402 works exactly as `makePaidFetch` wraps it; no changes needed for specialists.
3. Server scheme auto-advertises facilitator addresses — sellers need no extra config.
4. For the 7715 user-grant path, the user's MetaMask account is 7702-upgraded by the
   extension during the grant UX → same facilitator requirement satisfied.
