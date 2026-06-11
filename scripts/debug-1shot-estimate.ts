// Debug: build the chief bundle and print the RAW estimate response.
import "dotenv/config";
import { encodeFunctionData, erc20Abi, getAddress, bytesToHex, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "node:crypto";
import { createDelegation, ScopeType } from "@metamask/smart-accounts-kit";
import { make7702SmartAccount, publicClientFor } from "../packages/chain/src/accounts.js";
import { OneShotClient } from "../packages/chain/src/oneshot/client.js";
import { CHAINS, ONESHOT_TESTNET, requireEnv } from "../packages/chain/src/config.js";

const chain = CHAINS.demo;
const pk = requireEnv("DEV_CHIEF_PK") as Hex;
const eoa = privateKeyToAccount(pk);
const publicClient = publicClientFor(chain);
const oneshot = new OneShotClient(ONESHOT_TESTNET);
const caps = await oneshot.getCapabilities(chain.id);
const usdc = caps.tokens.find((t) => t.symbol === "USDC")!;
const chief = await make7702SmartAccount(pk, chain);

const nonce = await publicClient.getTransactionCount({ address: eoa.address, blockTag: "pending" });
const impl = chief.environment.implementations.EIP7702StatelessDeleGatorImpl;
const auth = await eoa.signAuthorization({ chainId: chain.id, contractAddress: getAddress(impl), nonce });

const fee = parseUnits("0.01", 6);
const PAYOUT = 8_000_000n;
const delegation = createDelegation({
  to: caps.targetAddress as Hex,
  from: chief.address,
  environment: chief.environment,
  salt: bytesToHex(randomBytes(32)),
  scope: {
    type: ScopeType.Erc20TransferAmount,
    tokenAddress: usdc.address as Hex,
    maxAmount: fee + PAYOUT,
  },
});
const signature = await chief.signDelegation({ delegation });

const params = {
  chainId: String(chain.id),
  authorizationList: [
    {
      address: auth.address,
      chainId: auth.chainId,
      nonce: auth.nonce,
      r: auth.r,
      s: auth.s,
      yParity: auth.yParity ?? 0,
    },
  ],
  transactions: [
    {
      permissionContext: [{ ...delegation, signature }],
      executions: [
        {
          target: usdc.address,
          value: "0",
          data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [caps.feeCollector as Hex, fee] }),
        },
        {
          target: usdc.address,
          value: "0",
          data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [eoa.address, 1000n] }),
        },
      ],
    },
  ],
};

const res = await fetch(ONESHOT_TESTNET, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(
    { jsonrpc: "2.0", id: 1, method: "relayer_estimate7710Transaction", params },
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
  ),
});
console.log(JSON.stringify(await res.json(), null, 2));
