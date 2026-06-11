// Check real USDC balances on Base mainnet for the two demo wallets.
import "dotenv/config";
import { createPublicClient, http, erc20Abi, formatUnits, type Hex } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ADDRESSES, requireEnv } from "../packages/chain/src/config.js";

const client = createPublicClient({ chain: base, transport: http() });

const wallets = [
  { label: "Agent (buyer)", pk: "DEV_BUYER_PK", needs: "$5 Venice + buffer" },
  { label: "Chief (settlement)", pk: "DEV_CHIEF_PK", needs: "1Shot fees + payroll" },
];

for (const w of wallets) {
  const addr = privateKeyToAccount(requireEnv(w.pk) as Hex).address;
  const [eth, usdc] = await Promise.all([
    client.getBalance({ address: addr }),
    client.readContract({
      address: ADDRESSES.usdcBase,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [addr],
    }),
  ]);
  console.log(
    `${w.label}\n  ${addr}\n  USDC: ${formatUnits(usdc, 6)}  ETH: ${formatUnits(eth, 18)}  — needs: ${w.needs}\n`,
  );
}
