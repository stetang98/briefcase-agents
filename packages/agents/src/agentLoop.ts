import type { VeniceClient, VeniceMessage } from "./venice.js";
import { toVeniceTools, type ToolMap } from "./tools.js";

export interface AgentLoopOptions {
  venice: VeniceClient;
  model: string;
  system: string;
  task: string;
  tools: ToolMap;
  /** Hard cap on model round-trips (cost/runaway protection). Default 8. */
  maxSteps?: number;
  /** Sampling temperature; low values keep specialist sections faithful. */
  temperature?: number;
  onEvent?: (e: { type: string; detail?: string }) => void;
  /** Kill switch: aborts in-flight Venice calls and stops further steps. */
  signal?: AbortSignal;
}
export interface AgentResult {
  text: string;
  steps: number;
  failed?: boolean;
}

/**
 * Generic tool-calling loop. Tool failures are reported back to the model as
 * tool messages (the agent can adapt); only infra errors (Venice down) throw.
 */
export async function runAgentLoop(o: AgentLoopOptions): Promise<AgentResult> {
  const messages: VeniceMessage[] = [
    { role: "system", content: o.system },
    { role: "user", content: o.task },
  ];
  const max = o.maxSteps ?? 8;
  const veniceTools = toVeniceTools(o.tools);

  for (let step = 1; step <= max; step++) {
    if (o.signal?.aborted) {
      throw o.signal.reason instanceof Error ? o.signal.reason : new Error("agent loop aborted");
    }
    const msg = await o.venice.chat(
      {
        model: o.model,
        messages,
        ...(o.temperature !== undefined ? { temperature: o.temperature } : {}),
        ...(veniceTools.length > 0 ? { tools: veniceTools, tool_choice: "auto" as const } : {}),
      },
      o.signal,
    );
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      return { text: msg.content ?? "", steps: step };
    }
    for (const call of msg.tool_calls) {
      // Tools can SPEND (x402 payments) — never execute one after the kill switch.
      if (o.signal?.aborted) {
        throw o.signal.reason instanceof Error ? o.signal.reason : new Error("agent loop aborted");
      }
      const tool = o.tools[call.function.name];
      let content: string;
      try {
        const args: unknown = JSON.parse(call.function.arguments || "{}");
        if (tool) {
          const result = await tool.run(args);
          content = JSON.stringify(result);
        } else {
          content = JSON.stringify({ error: `unknown tool: ${call.function.name}` });
        }
      } catch (err) {
        content = JSON.stringify({
          error: err instanceof Error ? err.message : "tool execution failed",
        });
      }
      o.onEvent?.({ type: "tool", detail: call.function.name });
      messages.push({ role: "tool", content, tool_call_id: call.id });
    }
  }
  return { text: "Step limit reached before completion.", steps: max, failed: true };
}
