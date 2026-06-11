import { describe, it, expect, vi } from "vitest";
import { runAgentLoop } from "../src/agentLoop.js";
import type { VeniceMessage } from "../src/venice.js";

const toolCallMsg: VeniceMessage = {
  role: "assistant",
  content: null,
  tool_calls: [{ id: "1", type: "function", function: { name: "echo", arguments: '{"x":"hi"}' } }],
};
const finalMsg: VeniceMessage = { role: "assistant", content: "done: hi" };

const echoTool = {
  description: "echo back",
  parameters: { type: "object", properties: { x: { type: "string" } } },
  run: async (a: { x: string }) => ({ echoed: a.x }),
};

describe("runAgentLoop", () => {
  it("dispatches tool calls then returns the final message", async () => {
    const chat = vi.fn().mockResolvedValueOnce(toolCallMsg).mockResolvedValueOnce(finalMsg);
    const result = await runAgentLoop({
      venice: { chat } as never,
      model: "m",
      system: "s",
      task: "t",
      maxSteps: 5,
      tools: { echo: echoTool },
    });
    expect(result.text).toBe("done: hi");
    expect(result.steps).toBe(2);
    expect(result.failed).toBeUndefined();
    // the tool result must have been fed back as a tool message
    const secondCallMessages = chat.mock.calls[1][0].messages;
    const toolMsg = secondCallMessages.find((m: VeniceMessage) => m.role === "tool");
    expect(JSON.parse(toolMsg.content)).toEqual({ echoed: "hi" });
    expect(toolMsg.tool_call_id).toBe("1");
  });

  it("stops with failed=true when maxSteps is exhausted", async () => {
    const chat = vi.fn().mockResolvedValue(toolCallMsg); // never returns a final answer
    const result = await runAgentLoop({
      venice: { chat } as never,
      model: "m",
      system: "s",
      task: "t",
      maxSteps: 3,
      tools: { echo: echoTool },
    });
    expect(result.failed).toBe(true);
    expect(result.steps).toBe(3);
    expect(chat).toHaveBeenCalledTimes(3);
  });

  it("reports tool errors back to the model instead of throwing", async () => {
    const boomTool = {
      description: "always fails",
      parameters: {},
      run: async () => {
        throw new Error("boom");
      },
    };
    const callBoom: VeniceMessage = {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "9", type: "function", function: { name: "boom", arguments: "{}" } }],
    };
    const chat = vi.fn().mockResolvedValueOnce(callBoom).mockResolvedValueOnce(finalMsg);
    const result = await runAgentLoop({
      venice: { chat } as never,
      model: "m",
      system: "s",
      task: "t",
      tools: { boom: boomTool },
    });
    expect(result.text).toBe("done: hi");
    const toolMsg = chat.mock.calls[1][0].messages.find((m: VeniceMessage) => m.role === "tool");
    expect(JSON.parse(toolMsg.content).error).toMatch(/boom/);
  });

  it("handles unknown tool names gracefully", async () => {
    const callUnknown: VeniceMessage = {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "2", type: "function", function: { name: "nope", arguments: "{}" } }],
    };
    const chat = vi.fn().mockResolvedValueOnce(callUnknown).mockResolvedValueOnce(finalMsg);
    const result = await runAgentLoop({
      venice: { chat } as never,
      model: "m",
      system: "s",
      task: "t",
      tools: {},
    });
    expect(result.text).toBe("done: hi");
    const toolMsg = chat.mock.calls[1][0].messages.find((m: VeniceMessage) => m.role === "tool");
    expect(JSON.parse(toolMsg.content).error).toMatch(/unknown tool/);
  });

  it("emits tool events via onEvent", async () => {
    const chat = vi.fn().mockResolvedValueOnce(toolCallMsg).mockResolvedValueOnce(finalMsg);
    const events: { type: string; detail?: string }[] = [];
    await runAgentLoop({
      venice: { chat } as never,
      model: "m",
      system: "s",
      task: "t",
      tools: { echo: echoTool },
      onEvent: (e) => events.push(e),
    });
    expect(events).toContainEqual({ type: "tool", detail: "echo" });
  });
});
