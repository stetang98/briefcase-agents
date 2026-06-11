// Generate burner dev keys into .env (refuses to overwrite an existing .env).
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
