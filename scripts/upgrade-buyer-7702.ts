// Upgrade the buyer EOA to a 7702 smart account via the 1Shot relayer,
// paying the relay fee in USDC (zero ETH). Single execution: the fee transfer.
import "dotenv/config";
import { encodeFunctionData, erc20Abi, getAddress, bytesToHex, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "node:crypto";
import { createDelegation, ScopeType } from "@metamask/smart-accounts-kit";
import { make7702SmartAccount, publicClientFor } from "../packages/chain/src/accounts.js";
import { OneShotClient, type OneShotBundle } from "../packages/chain/src/oneshot/client.js";
import { CHAINS, ONESHOT_TESTNET, requireEnv } from "../packages/chain/src/config.js";

const chain = CHAINS.demo;
const pk = requireEnv("DEV_BUYER_PK") as Hex;
const eoa = privateKeyToAccount(pk);
const publicClient = publicClientFor(chain);
const oneshot = new OneShotClient(ONESHOT_TESTNET);

const caps = await oneshot.getCapabilities(chain.id);
const usdc = caps.tokens.find((t) => t.symbol === "USDC");
if (!usdc) throw new Error("relayer does not accept USDC");

const account = await make7702SmartAccount(pk, chain);

const code = await publicClient.getCode({ address: eoa.address });
if (code && code !== "0x") {
  console.log("buyer EOA already upgraded:", code.slice(0, 20), "…");
  process.exit(0);
}
const nonce = await publicClient.getTransactionCount({
  address: eoa.address,
  blockTag: "pending",
});
const impl = account.environment.implementations.EIP7702StatelessDeleGatorImpl;
const auth = await eoa.signAuthorization({
  chainId: chain.id,
  contractAddress: getAddress(impl),
  nonce,
});
const authorizationList: OneShotBundle["authorizationList"] = [
  {
    address: auth.address,
    chainId: auth.chainId,
    nonce: auth.nonce,
    r: auth.r,
    s: auth.s,
    yParity: auth.yParity ?? 0,
  },
];

async function buildSigned(fee: bigint): Promise<OneShotBundle> {
  const delegation = createDelegation({
    to: caps.targetAddress as Hex,
    from: account.address,
    environment: account.environment,
    salt: bytesToHex(randomBytes(32)),
    scope: {
      type: ScopeType.Erc20TransferAmount,
      tokenAddress: usdc!.address as Hex,
      maxAmount: fee,
    },
  });
  const signature = await account.signDelegation({ delegation });
  return {
    chainId: String(chain.id),
    authorizationList,
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
        ],
      },
    ],
  };
}

const feeData = await oneshot.getFeeData(chain.id, usdc.address);
const decimals = feeData.token?.decimals ?? 6;
const parseFee = (s: string) => parseUnits(s, decimals);
const taskId = await oneshot.estimateThenSend(buildSigned, parseFee(feeData.minFee), {
  memo: "buyer-7702-upgrade",
});
console.log("taskId:", taskId);

for (;;) {
  const s = await oneshot.getStatus(taskId);
  console.log("status:", s.status, s.hash ?? "");
  if (s.status >= 200) break;
  await new Promise((r) => setTimeout(r, 3000));
}
const after = await publicClient.getCode({ address: eoa.address });
console.log("buyer EOA code after:", after?.slice(0, 30) ?? "0x", "(0xef0100… = upgraded)");
