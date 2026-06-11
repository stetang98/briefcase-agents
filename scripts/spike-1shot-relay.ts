// LIVE SPIKE: Chief EOA upgrades itself via EIP-7702 and relays an ERC-7710
// bundle through the 1Shot testnet relayer, paying the fee in USDC (zero ETH).
import "dotenv/config";
import { encodeFunctionData, erc20Abi, getAddress, bytesToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "node:crypto";
import { createDelegation, ScopeType } from "@metamask/smart-accounts-kit";
import { makeChief7702Account, publicClientFor } from "../packages/chain/src/accounts.js";
import { OneShotClient, type OneShotBundle } from "../packages/chain/src/oneshot/client.js";
import { CHAINS, ONESHOT_TESTNET, requireEnv } from "../packages/chain/src/config.js";

const chain = CHAINS.demo;
const pk = requireEnv("DEV_CHIEF_PK") as Hex;
const eoa = privateKeyToAccount(pk);
const publicClient = publicClientFor(chain);
const oneshot = new OneShotClient(ONESHOT_TESTNET);

const caps = await oneshot.getCapabilities(chain.id);
const usdc = caps.tokens.find((t) => t.symbol === "USDC");
if (!usdc) throw new Error("relayer does not accept USDC on this chain");
console.log("relayer target:", caps.targetAddress, "feeCollector:", caps.feeCollector);

const chief = await makeChief7702Account(pk, chain);

// EIP-7702 authorization — only while the EOA is not yet upgraded.
const code = await publicClient.getCode({ address: eoa.address });
let authorizationList: OneShotBundle["authorizationList"];
if (!code || code === "0x") {
  const nonce = await publicClient.getTransactionCount({
    address: eoa.address,
    blockTag: "pending",
  });
  const impl = chief.environment.implementations.EIP7702StatelessDeleGatorImpl;
  const auth = await eoa.signAuthorization({
    chainId: chain.id,
    contractAddress: getAddress(impl),
    nonce,
  });
  authorizationList = [
    {
      address: auth.address,
      chainId: auth.chainId,
      nonce: auth.nonce,
      r: auth.r,
      s: auth.s,
      yParity: auth.yParity ?? 0,
    },
  ];
  console.log("EOA not yet upgraded — attaching 7702 authorization for", impl);
} else {
  console.log("EOA already upgraded, code:", code.slice(0, 20), "…");
}

const PAYOUT = 10000n; // 0.01 USDC demo payout back to self

async function buildSigned(fee: bigint): Promise<OneShotBundle> {
  const delegation = createDelegation({
    to: caps.targetAddress as Hex,
    from: chief.address,
    environment: chief.environment,
    salt: bytesToHex(randomBytes(32)),
    scope: {
      type: ScopeType.Erc20TransferAmount,
      tokenAddress: usdc!.address as Hex,
      maxAmount: fee + PAYOUT,
    },
  });
  const signature = await chief.signDelegation({ delegation });
  return {
    chainId: String(chain.id),
    ...(authorizationList ? { authorizationList } : {}),
    transactions: [
      {
        permissionContext: [{ ...delegation, signature }],
        executions: [
          {
            target: usdc!.address,
            value: "0",
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "transfer",
              args: [caps.feeCollector as Hex, fee],
            }),
          },
          {
            target: usdc!.address,
            value: "0",
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "transfer",
              args: [eoa.address, PAYOUT],
            }),
          },
        ],
      },
    ],
  };
}

const feeData = await oneshot.getFeeData(chain.id, usdc.address);
console.log("minFee (USDC base units):", feeData.minFee);

const taskId = await oneshot.estimateThenSend(buildSigned, BigInt(feeData.minFee), {
  memo: "briefcase-spike",
  ...(process.env.WEBHOOK_URL ? { destinationUrl: process.env.WEBHOOK_URL } : {}),
});
console.log("taskId:", taskId);

for (;;) {
  const s = await oneshot.getStatus(taskId);
  console.log("status:", s.status, s.hash ?? "");
  if (s.status >= 200) {
    console.log(JSON.stringify(s, null, 2));
    break;
  }
  await new Promise((r) => setTimeout(r, 3000));
}

const codeAfter = await publicClient.getCode({ address: eoa.address });
console.log("EOA code after:", codeAfter?.slice(0, 30) ?? "0x", "(0xef0100… = upgraded)");
