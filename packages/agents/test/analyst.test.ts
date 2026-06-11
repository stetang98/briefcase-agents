import { describe, it, expect, vi } from "vitest";
import {
  readChainSnapshot,
  analystTask,
  analystFallbackText,
  isGrounded,
} from "../src/analyst.js";

describe("readChainSnapshot", () => {
  it("reads block height and gas price and decodes them in code", async () => {
    const publicRpc = vi.fn().mockImplementation(async (method: string) => {
      if (method === "eth_blockNumber") return "0x28bb71f"; // 42_710_815
      if (method === "eth_gasPrice") return "0x92b40"; // 600_896 wei
      throw new Error(`unexpected method ${method}`);
    });
    const onRead = vi.fn();
    const s = await readChainSnapshot(publicRpc, onRead);
    expect(s).toEqual({
      blockNumber: 42710815,
      gasWei: "600896",
      gasGwei: "0.000600896",
    });
    // One narrative event per real RPC read.
    expect(onRead).toHaveBeenCalledTimes(2);
  });

  it("throws when the RPC returns a non-numeric result", async () => {
    const publicRpc = vi.fn().mockResolvedValue("not-hex");
    await expect(readChainSnapshot(publicRpc)).rejects.toThrow(/unexpected/i);
  });

  it("kill switch: an aborted signal stops reads before any RPC call", async () => {
    const publicRpc = vi.fn().mockResolvedValue("0x1");
    const controller = new AbortController();
    controller.abort();
    await expect(
      readChainSnapshot(publicRpc, undefined, controller.signal),
    ).rejects.toThrow();
    expect(publicRpc).not.toHaveBeenCalled();
  });
});

describe("analystTask / analystFallbackText", () => {
  const snapshot = { blockNumber: 42710815, gasWei: "600896", gasGwei: "0.000600896" };

  it("embeds the topic and the exact readings in the task", () => {
    const task = analystTask("eigenlayer", snapshot);
    expect(task).toContain("eigenlayer");
    expect(task).toContain("42710815");
    expect(task).toContain("0.000600896");
    expect(task).toMatch(/Base Sepolia/i);
  });

  it("fallback text names the topic and quotes the readings and the testnet", () => {
    const text = analystFallbackText("eigenlayer", snapshot);
    expect(text).toContain("eigenlayer");
    expect(text).toContain("42710815");
    expect(text).toContain("0.000600896");
    expect(text).toMatch(/Base Sepolia/i);
    expect(text).toMatch(/testnet/i);
    // A report section, not a chat: no questions to the reader.
    expect(text).not.toContain("?");
  });
});

describe("isGrounded", () => {
  const snapshot = { blockNumber: 42710815, gasWei: "600896", gasGwei: "0.000600896" };

  it("accepts text quoting the block number verbatim", () => {
    expect(isGrounded("Base Sepolia stands at block 42710815.", snapshot)).toBe(true);
  });

  it("accepts thousands separators and spacing variants", () => {
    expect(isGrounded("block height 42,710,815 with low gas", snapshot)).toBe(true);
    expect(isGrounded("block_HEIGHT: 42 710 815", snapshot)).toBe(true);
  });

  it("rejects encyclopedic text that never quotes the reading", () => {
    expect(
      isGrounded("EigenLayer is an Ethereum protocol introducing restaking.", snapshot),
    ).toBe(false);
  });

  it("rejects empty text", () => {
    expect(isGrounded("", snapshot)).toBe(false);
  });

  it("rejects the block number embedded inside a longer digit run", () => {
    // Block 1 must NOT match the '1' inside '100,000' or '$13k-style figures.
    const tiny = { blockNumber: 1, gasWei: "1", gasGwei: "0.000000001" };
    expect(isGrounded("Over 100,000 validators secure 250 protocols.", tiny)).toBe(false);
    expect(isGrounded("Base Sepolia stands at block 1 right now.", tiny)).toBe(true);
    // Real-size block embedded in a longer number is still rejected.
    expect(isGrounded("tx volume hit 427108150 this week", snapshot)).toBe(false);
  });
});
