// Live read-only check against the real 1Shot testnet relayer (no auth needed).
import { OneShotClient } from "../packages/chain/src/oneshot/client.js";
import { ONESHOT_TESTNET } from "../packages/chain/src/config.js";

const client = new OneShotClient(ONESHOT_TESTNET);
const caps = await client.getCapabilities(84532);
console.log(JSON.stringify(caps, null, 2));
