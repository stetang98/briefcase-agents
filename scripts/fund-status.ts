// Print all addresses that need funding and their current Base Sepolia balances.
import "dotenv/config";
import { erc20Abi, formatUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { makeBuyerSmartAccount, publicClientFor } from "../packages/chain/src/accounts.js";
import { CHAINS, ADDRESSES, requireEnv } from "../packages/chain/src/config.js";

const chain = CHAINS.demo;
const client = publicClientFor(chain);

const buyerPk = requireEnv("DEV_BUYER_PK") as Hex;
const chiefPk = requireEnv("DEV_CHIEF_PK") as Hex;
const buyerEoa = privateKeyToAccount(buyerPk);
const chiefEoa = privateKeyToAccount(chiefPk);
const buyerSmart = await makeBuyerSmartAccount(buyerPk, chain);

const rows: { label: string; address: Hex; needs: string }[] = [
  { label: "buyer EOA (signer)", address: buyerEoa.address, needs: "nothing (signer only)" },
  { label: "buyer SMART ACCOUNT", address: buyerSmart.address, needs: "USDC >= 1 (x402 payments)" },
  { label: "chief EOA (7702)", address: chiefEoa.address, needs: "USDC >= 1, NO ETH needed (1Shot)" },
];

for (const r of rows) {
  const [eth, usdc] = await Promise.all([
    client.getBalance({ address: r.address }),
    client.readContract({
      address: ADDRESSES.usdcBaseSepolia,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [r.address],
    }),
  ]);
  console.log(
    `${r.label}\n  ${r.address}\n  ETH: ${formatUnits(eth, 18)}  USDC: ${formatUnits(usdc, 6)}  — needs: ${r.needs}\n`,
  );
}
