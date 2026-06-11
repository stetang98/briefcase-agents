import { decodeRpcResult } from "./specialistTools.js";

/**
 * Code-grounded data for the analyst. The flash-tier model proved unreliable
 * at choosing to call read_chain and at decoding results, so the chief reads
 * the chain itself (real RPC reads, surfaced as narrative tool events) and
 * hands the analyst pre-decoded numbers to write around.
 */
export interface ChainReadings {
  blockNumber: number | string;
  gasWei: string;
  gasGwei: string;
}

/** Read live block height + gas price; `onRead` fires once per real RPC read. */
export async function readChainSnapshot(
  publicRpc: (method: string, params: unknown[]) => Promise<unknown>,
  onRead?: () => void,
  signal?: AbortSignal,
): Promise<ChainReadings> {
  const read = async (method: string) => {
    // Kill switch reaches the chief's own reads, same as specialist tools.
    if (signal?.aborted) throw new Error("aborted: permission revoked");
    const result = await publicRpc(method, []);
    onRead?.();
    const decoded = decodeRpcResult(method, result);
    if (!decoded) throw new Error(`unexpected ${method} result: ${String(result)}`);
    return decoded;
  };
  const block = (await read("eth_blockNumber")) as { blockNumber: number | string };
  const gas = (await read("eth_gasPrice")) as { wei: string; gwei: string };
  return { blockNumber: block.blockNumber, gasWei: gas.wei, gasGwei: gas.gwei };
}

/** The analyst's task message, carrying the readings it must quote. */
export function analystTask(topic: string, r: ChainReadings): string {
  return (
    `Research topic: ${topic}. Live readings from Base Sepolia testnet ` +
    `(chainId 84532), already decoded — quote them verbatim, without thousands ` +
    `separators: block height ${r.blockNumber}; gas price ${r.gasGwei} gwei ` +
    `(${r.gasWei} wei).`
  );
}

/** Deterministic section used when the model's text fails the grounding check. */
export function analystFallbackText(topic: string, r: ChainReadings): string {
  return (
    `On-chain conditions at the time of this ${topic} brief — live Base Sepolia ` +
    `(testnet, chainId 84532) readings: block height ${r.blockNumber}; gas price ` +
    `${r.gasGwei} gwei (${r.gasWei} wei). Sub-cent gas and steady block production ` +
    `leave ample headroom for agent-driven x402 settlement, isolated from mainnet ` +
    `conditions.`
  );
}

/**
 * Accept the model's text only if it actually quotes the live block height
 * (separators/spacing normalized away, digit boundaries enforced so the
 * height never matches inside an unrelated longer number). Anything else —
 * encyclopedic prose, chat, hallucinated networks — gets the fallback.
 */
export function isGrounded(text: string, r: ChainReadings): boolean {
  const normalized = text.replace(/[,\s_]/g, "");
  const blockPattern = new RegExp(`(?<!\\d)${String(r.blockNumber)}(?!\\d)`);
  return blockPattern.test(normalized);
}
